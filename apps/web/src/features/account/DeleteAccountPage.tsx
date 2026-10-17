import { buttonClass } from '../../components/ui/Button';
import { useQuery } from '@tanstack/react-query';
import { DELETE_ACCOUNT_CONFIRMATION, type DeletionPreview } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/apiClient';
import { useOnline } from '../../lib/useOnline';
import { useAuth } from '../auth/AuthProvider';
import { pendingCounts, usePending } from '../offline/usePending';
import { canConfirmDeletion, tripConsequences } from './deletionModel';

/** Feature 006 (RF-56): consequences, blocks and explicit confirmation before deleting the account. */
export function DeleteAccountPage() {
  const { deleteAccount } = useAuth();
  const online = useOnline();
  const preview = useQuery({ queryKey: ['deletion-preview'], queryFn: () => api<DeletionPreview>('GET', '/me/deletion-preview') });
  const { pending } = usePending();
  const { waiting, attention } = pendingCounts(pending);
  const unsent = waiting + attention;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const data = preview.data;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (e) {
      setError(e);
      setBusy(false);
      void preview.refetch();
    }
  };

  return (
    <section aria-labelledby="delete-title" className="space-y-5">
      <div className="space-y-2">
        <h1 id="delete-title" className="text-2xl font-bold">
          Borrar mi cuenta
        </h1>
        <p className="text-slate-700">
          Se eliminarán tu nombre, tu correo, tu foto, tus notificaciones y tus comprobantes privados, y no podrás volver a
          entrar con esta cuenta. En los viajes aparecerás como «Participante eliminado» y los saldos del grupo no cambiarán.
        </p>
      </div>

      {preview.isPending && <Spinner />}
      {preview.error && <ErrorMessage error={preview.error} />}

      {data && (
        <>
          {data.trips.length === 0 ? (
            <p className="text-slate-700">No participas en ningún viaje.</p>
          ) : (
            <ul aria-label="Viajes afectados" className="space-y-3">
              {data.trips.map((t) => (
                <li key={t.tripId} className="rounded-2xl border border-slate-200/70 bg-surface shadow-card bg-white p-4">
                  <p className="font-semibold">{t.name}</p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {tripConsequences(t).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {t.pendingSettlements.length > 0 && (
                    <Link to={`/trips/${t.tripId}`} className="mt-2 inline-block text-sm font-medium text-brand-800 underline">
                      Ver los pagos de {t.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-slate-700">
            {data.attachmentsToDelete === 0
              ? 'No hay comprobantes privados que borrar.'
              : `Se borrarán ${data.attachmentsToDelete} ${data.attachmentsToDelete === 1 ? 'comprobante' : 'comprobantes'} de tus gastos personales. Los de gastos compartidos se conservan para el grupo hasta su vencimiento.`}
          </p>
          {unsent > 0 && (
            <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Tienes {unsent} {unsent === 1 ? 'gasto sin enviar' : 'gastos sin enviar'} en este dispositivo: se descartarán.
            </p>
          )}
          {data.blocked && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Tienes pagos pendientes de confirmar. Resuélvelos o cancélalos antes de borrar la cuenta.
            </p>
          )}

          <div className="space-y-2">
            <label htmlFor="confirm-delete" className="block text-sm font-medium">
              Escribe {DELETE_ACCOUNT_CONFIRMATION} para confirmar
            </label>
            <input
              id="confirm-delete"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoComplete="off"
              disabled={data.blocked || busy}
              className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </div>
          {!online && <p className="text-sm text-slate-700">Necesitas conexión para borrar la cuenta.</p>}
          <ErrorMessage error={error} />
          <div className="flex flex-wrap gap-2">
            <Link to="/" className={buttonClass('secondary', 'md')}>
              Cancelar
            </Link>
            <button
              type="button"
              disabled={!canConfirmDeletion(text, data, online) || busy}
              onClick={() => void submit()}
              className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Borrando…' : 'Borrar mi cuenta definitivamente'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
