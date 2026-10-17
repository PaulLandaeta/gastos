import { buttonClass } from '../../components/ui/Button';
import { CameraIcon, FolderOpenIcon } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AI_CONSENT_VERSION, MAX_SCAN_FILES, hasActiveConsent, type AiConsent, type ScanResponse } from 'contracts';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { ApiError, api } from '../../lib/apiClient';
import { useDoc } from '../../lib/useFirestore';
import { localProblem, type UploadedFile } from '../attachments/AttachmentPicker';
import { ACCEPT, uploadFiles } from '../attachments/upload';
import { useCurrentUser } from '../auth/AuthProvider';
import { useTrip } from '../trips/useTrip';
import { useScanQuota } from './useScanQuota';

/** What the new-expense page receives after a scan (or after a failed one, to register by hand). */
export interface ScanNavigationState {
  scan?: ScanResponse;
  uploads?: UploadedFile[];
}

type Step = 'idle' | 'uploading' | 'analysing';

/** FR-015: explicit consent before the first scan; revocable from the scan page. */
function ConsentDialog({ onAccept, busy, error, manualTo }: { onAccept: () => void; busy: boolean; error: unknown; manualTo: string }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4 shadow-sm">
      <h2 id="consent-title" className="text-lg font-semibold tracking-tight">
        Antes de escanear
      </h2>
      <p className="text-sm text-slate-800">
        Para leer la factura, la foto o el PDF se envía a un proveedor externo de IA (OpenAI).
        <strong> OpenAI no usa esas imágenes para entrenar sus modelos, pero puede conservarlas hasta 30 días</strong> para
        detectar abusos. No escanees comprobantes con datos que no quieras compartir.
      </p>
      <p className="text-sm text-slate-700">
        Puedes retirar tu consentimiento cuando quieras; el registro manual con adjuntos sigue disponible sin él. (Versión del aviso:{' '}
        {AI_CONSENT_VERSION})
      </p>
      <ErrorMessage error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onAccept} className={buttonClass('primary', 'md')}>
          Acepto
        </button>
        <Link to={manualTo} className={buttonClass('secondary', 'md')}>
          No, registrar a mano
        </Link>
      </div>
    </div>
  );
}

/** HU-04: take or choose photos/PDF, upload them, analyse with AI and open the prefilled form. */
export function ScanPage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const { trip, loading } = useTrip(tripId);
  const profile = useDoc<{ aiConsent?: AiConsent | null }>(`users/${user.uid}`);
  const quota = useScanQuota(tripId, trip?.status === 'active');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const key = useRef(crypto.randomUUID());

  const accept = useMutation({ mutationFn: () => api('POST', '/me/ai-consent', { body: { version: AI_CONSENT_VERSION } }) });
  const revoke = useMutation({ mutationFn: () => api('DELETE', '/me/ai-consent') });

  if (loading || trip === undefined || profile.loading) return <Spinner />;
  if (trip === null) return <NotFound />;
  const manualTo = `/trips/${tripId}/expenses/new`;
  if (trip.status !== 'active') {
    return <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Este viaje no admite gastos en su estado actual.</p>;
  }
  const consented = hasActiveConsent(profile.data?.aiConsent ?? null) || (accept.isSuccess && !revoke.isSuccess);
  const exhausted = quota.data?.tripRemainingToday === 0;

  async function analyse(files: File[]) {
    setError(null);
    setProblem(localProblem(files) ?? (files.length > MAX_SCAN_FILES ? `Puedes analizar hasta ${MAX_SCAN_FILES} archivos a la vez.` : null));
    if (localProblem(files) || files.length > MAX_SCAN_FILES) return;
    let ids = uploaded.map((u) => u.id);
    try {
      if (ids.length === 0) {
        setStep('uploading');
        ids = await uploadFiles(tripId, files);
        const list = ids.map((id, i) => ({ id, name: files[i]!.name }));
        setUploaded(list);
      }
      setStep('analysing');
      const scan = await api<ScanResponse>('POST', `/trips/${tripId}/scans`, { body: { uploadIds: ids }, idempotencyKey: key.current });
      void queryClient.invalidateQueries({ queryKey: ['scan-quota', tripId] });
      const uploads = ids.map((id, i) => ({ id, name: files[i]?.name ?? `archivo-${i + 1}` }));
      navigate(manualTo, { state: { scan, uploads } satisfies ScanNavigationState });
    } catch (e) {
      setError(e);
      void queryClient.invalidateQueries({ queryKey: ['scan-quota', tripId] });
      if (!(e instanceof ApiError && e.code === 'NETWORK')) key.current = crypto.randomUUID();
    } finally {
      setStep('idle');
    }
  }

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) {
      setUploaded([]);
      void analyse(files);
    }
  };

  const busy = step !== 'idle';
  const failed = error instanceof ApiError && ['AI_UNAVAILABLE', 'AI_QUOTA_EXCEEDED'].includes(error.code);
  const button = 'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl px-4 py-5 text-center font-semibold';
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Escanear factura</h1>
      <p className="text-sm text-slate-600">
        {trip.name} · Moneda {trip.currency}
      </p>
      {!consented ? (
        <ConsentDialog onAccept={() => accept.mutate()} busy={accept.isPending} error={accept.error} manualTo={manualTo} />
      ) : (
        <>
          {quota.data && (
            <p className="text-sm text-slate-700" data-testid="scan-quota">
              {exhausted ? 'Cuota de escaneo agotada por hoy.' : `Quedan ${quota.data.tripRemainingToday} escaneos hoy en este viaje.`}
            </p>
          )}
          {exhausted ? (
            <p role="status" className="rounded-lg bg-amber-50 p-3 text-amber-900">
              Cuota de escaneo agotada.{' '}
              <Link to={manualTo} className="font-semibold underline">
                Registrar a mano
              </Link>
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label htmlFor="scan-camera" className={`${button} bg-brand-700 text-white ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                <CameraIcon size={28} weight="duotone" />
                Tomar foto
              </label>
              <input id="scan-camera" type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={onFiles} />
              <label htmlFor="scan-files" className={`${button} border border-slate-300 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                <FolderOpenIcon size={28} weight="duotone" />
                Elegir fotos o PDF
              </label>
              <input id="scan-files" type="file" multiple accept={ACCEPT} className="sr-only" disabled={busy} onChange={onFiles} data-testid="scan-input" />
            </div>
          )}
          {busy && (
            <p role="status" className="text-sm text-slate-800">
              {step === 'uploading' ? 'Subiendo…' : 'Analizando la factura…'}
            </p>
          )}
          {problem && (
            <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
              {problem}
            </p>
          )}
          <ErrorMessage error={error} />
          {failed && (
            <Link
              to={manualTo}
              state={{ uploads: uploaded } satisfies ScanNavigationState}
              className={buttonClass('primary', 'lg', 'w-full')}
            >
              Registrar a mano{uploaded.length ? ' con la foto adjunta' : ''}
            </Link>
          )}
          <button type="button" onClick={() => revoke.mutate()} disabled={revoke.isPending} className="text-sm text-slate-700 underline">
            Retirar mi consentimiento de escaneo con IA
          </button>
          {revoke.isSuccess && <p role="status" className="text-sm">Consentimiento retirado.</p>}
        </>
      )}
    </div>
  );
}
