import { DEFAULT_CATEGORY_ID, type CreateExpenseResponse } from 'contracts';
import type { Member } from 'finance-engine';
import { useMemo, useRef, useState } from 'react';
import { formatDate, formatMoney } from '../../lib/format';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { ApiError, api } from '../../lib/apiClient';
import { useCurrentUser } from '../auth/AuthProvider';
import { AttachmentPicker, type UploadedFile } from '../attachments/AttachmentPicker';
import type { ScanNavigationState } from '../scan/ScanPage';
import { draftToFormDraft } from '../scan/scanDraft';
import { useTrip } from '../trips/useTrip';
import { AdjustmentsEditor } from './AdjustmentsEditor';
import { ExpenseForm } from './ExpenseForm';
import { ItemsEditor } from './ItemsEditor';
import { PayersEditor } from './PayersEditor';
import { evaluate, newDraft, toBody, type ExpenseDraft } from './expenseFormModel';
import { useCategories } from './useExpenses';

/** Local calendar date (not UTC): an evening expense must not land on tomorrow. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lastCategoryKey = (uid: string, tripId: string) => `lastCategory:${uid}:${tripId}`;

function readLastCategory(uid: string, tripId: string): string | null {
  try {
    return localStorage.getItem(lastCategoryKey(uid, tripId));
  } catch {
    return null;
  }
}

export interface SavedFlash {
  message: string;
  chargesByMember?: CreateExpenseResponse['expense']['chargesByMember'];
}

export function NewExpensePage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromScan = (location.state ?? null) as ScanNavigationState | null;
  const scan = fromScan?.scan;
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const { active: categories, loading: catLoading } = useCategories(tripId);
  const accepted = members.filter((m) => m.invitationStatus === 'accepted' && m.uid);
  const options = accepted.map((m) => ({ uid: m.uid!, name: m.displayName ?? m.email }));
  const engineMembers: Member[] = accepted.map((m) => ({ uid: m.uid!, joinOrder: m.joinOrder ?? 0 }));

  const [draft, setDraftState] = useState<ExpenseDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState<{ similar?: { description: string; transactionDate: string; totalMinor: number } } | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile[]>(fromScan?.uploads ?? []);
  const [review, setReview] = useState<{ fields: string[]; itemKeys: string[] }>({ fields: [], itemKeys: [] });
  const inFlight = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const ready = !loading && !catLoading && trip && options.length > 0;
  if (ready && draft === null) {
    const last = readLastCategory(user.uid, tripId);
    const categoryId = categories.find((c) => c.id === last)?.id ?? categories.find((c) => c.id === DEFAULT_CATEGORY_ID)?.id ?? categories[0]?.id ?? DEFAULT_CATEGORY_ID;
    const base = newDraft({ meUid: user.uid, memberUids: options.map((o) => o.uid), today: today(), categoryId });
    if (scan) {
      // FR-010: the AI draft opens in the same form; doubtful fields are flagged for review.
      const prefill = draftToFormDraft(scan.draft, base, options.map((o) => o.uid));
      setReview({ fields: prefill.reviewFields, itemKeys: prefill.reviewItemKeys });
      setDraftState(prefill.draft);
    } else {
      setDraftState(base);
    }
  }
  const setDraft = (updater: (d: ExpenseDraft) => ExpenseDraft) => setDraftState((d) => (d ? updater(d) : d));
  const evaluation = useMemo(
    () => (draft && trip ? evaluate(draft, engineMembers, trip.expenseSeq + 1) : null),
    [draft, trip?.expenseSeq, accepted.length],
  );

  if (loading || trip === undefined || catLoading) return <Spinner />;
  if (trip === null) return <NotFound />;
  if (trip.status !== 'active') {
    return <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Este viaje no admite gastos en su estado actual.</p>;
  }
  if (!draft || !evaluation) return <Spinner />;

  async function save(confirmDuplicate = false) {
    if (!draft || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setDuplicate(null);
    try {
      const res = await api<CreateExpenseResponse>('POST', `/trips/${tripId}/expenses`, {
        body: {
          ...toBody(draft),
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
          ...(uploaded.length ? { attachmentUploadIds: uploaded.map((u) => u.id) } : {}),
          ...(scan ? { scanId: scan.scanId } : {}),
        },
        idempotencyKey: idempotencyKey.current,
      });
      try {
        localStorage.setItem(lastCategoryKey(user.uid, tripId), draft.categoryId);
      } catch {
        // storage unavailable: ignore
      }
      idempotencyKey.current = crypto.randomUUID();
      const flash: SavedFlash = { message: 'Gasto guardado', chargesByMember: res.expense.chargesByMember };
      navigate(`/trips/${tripId}`, { state: { flash } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') {
        setDuplicate((e.details ?? {}) as { similar?: { description: string; transactionDate: string; totalMinor: number } });
      } else {
        setError(e);
      }
      // Keep the same key only for network failures (safe retry); new data after a domain error.
      if (!(e instanceof ApiError && e.code === 'NETWORK')) idempotencyKey.current = crypto.randomUUID();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{scan ? 'Revisar factura escaneada' : 'Nuevo gasto'}</h1>
      <p className="text-sm text-slate-600">
        {trip.name} · Moneda {trip.currency}
      </p>
      {scan && <ScanNotices warnings={scan.warnings} detected={scan.draft.detectedCurrency} currency={trip.currency} review={review} draft={draft} />}
      <ExpenseForm
        currency={trip.currency}
        members={options}
        categories={categories}
        draft={draft}
        setDraft={setDraft}
        evaluation={evaluation}
        saving={saving}
        onSubmit={() => void save()}
        review={review.fields}
        itemsSection={
          <>
            <ItemsEditor draft={draft} setDraft={setDraft} currency={trip.currency} members={options} issues={evaluation.issues} reviewItemKeys={review.itemKeys} />
            <AdjustmentsEditor draft={draft} setDraft={setDraft} currency={trip.currency} members={options} />
          </>
        }
        payersSection={<PayersEditor draft={draft} setDraft={setDraft} currency={trip.currency} members={options} />}
      >
        <section aria-label="Comprobantes" className="space-y-2">
          <h2 className="text-lg font-semibold">Comprobantes (opcional)</h2>
          {uploaded.length > 0 && (
            <ul className="space-y-1 text-sm">
              {uploaded.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1">
                  <span className="break-all">
                    📎 {u.name}
                    {scan && fromScan?.uploads?.some((x) => x.id === u.id) ? ' (escaneado)' : ''}
                  </span>
                  <button type="button" onClick={() => setUploaded((xs) => xs.filter((x) => x.id !== u.id))} className="text-red-700 underline">
                    Quitar <span className="sr-only">{u.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <AttachmentPicker tripId={tripId} disabled={saving} onUploaded={(files) => setUploaded((xs) => [...xs, ...files])} />
        </section>
        <ErrorMessage error={error} />
        {duplicate && (
          <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Posible duplicado</p>
            {duplicate.similar ? (
              <p>
                Ya existe «{duplicate.similar.description}» del {formatDate(duplicate.similar.transactionDate)} por{' '}
                {formatMoney(duplicate.similar.totalMinor, trip.currency)} con el mismo pagador.
              </p>
            ) : (
              <p>Hay un gasto con la misma fecha, importe y pagador.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setDuplicate(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
                Cancelar
              </button>
              <button type="button" onClick={() => void save(true)} className="rounded-lg bg-amber-700 px-3 py-2 font-medium text-white">
                Guardar de todos modos
              </button>
            </div>
          </div>
        )}
      </ExpenseForm>
    </div>
  );
}

const FIELD_NAME: Record<string, string> = { description: 'descripción', transactionDate: 'fecha', totalMinor: 'importe total' };

/** RF-26/RF-54: what the scan could not read with confidence, and currency/date/page warnings. */
function ScanNotices({
  warnings,
  detected,
  currency,
  review,
  draft,
}: {
  warnings: string[];
  detected: string | undefined;
  currency: string;
  review: { fields: string[]; itemKeys: string[] };
  draft: ExpenseDraft;
}) {
  const items = draft.items.filter((i) => review.itemKeys.includes(i.key)).map((i) => `«${i.description}»`);
  const toReview = [...review.fields.map((f) => FIELD_NAME[f] ?? f), ...items];
  return (
    <div className="space-y-2">
      {warnings.includes('CURRENCY_MISMATCH') && (
        <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          ⚠️ La factura parece estar en <strong>{detected}</strong> y el viaje usa <strong>{currency}</strong>. No se convierte
          automáticamente: introduce los importes en {currency}.
        </p>
      )}
      {toReview.length > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">⚠️ Revisa estos datos dudosos: {toReview.join(', ')}.</p>
      )}
      {warnings.includes('DATE_SUSPICIOUS') && <p className="text-sm text-amber-900">La fecha leída no era válida; se propuso la de hoy.</p>}
      {warnings.includes('DUPLICATE_PAGE') && <p className="text-sm text-amber-900">Hay páginas repetidas en las fotos: se adjuntará una sola vez.</p>}
      {warnings.includes('TOTAL_MISMATCH') && <p className="text-sm text-amber-900">Los ítems no suman el total impreso: revisa los importes.</p>}
      {warnings.includes('EMPTY') && <p className="text-sm text-amber-900">No se reconocieron datos: completa el gasto a mano con la foto adjunta.</p>}
      <p className="text-sm text-slate-700">Asigna quién participa en cada ítem. Solo podrás guardar cuando el total cuadre.</p>
    </div>
  );
}
