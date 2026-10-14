import { DEFAULT_CATEGORY_ID, type CreateExpenseResponse } from 'contracts';
import type { Member } from 'finance-engine';
import { useMemo, useRef, useState } from 'react';
import { formatDate, formatMoney } from '../../lib/format';
import { useNavigate, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { ApiError, api } from '../../lib/apiClient';
import { useCurrentUser } from '../auth/AuthProvider';
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
  const inFlight = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const ready = !loading && !catLoading && trip && options.length > 0;
  if (ready && draft === null) {
    const last = readLastCategory(user.uid, tripId);
    const categoryId = categories.find((c) => c.id === last)?.id ?? categories.find((c) => c.id === DEFAULT_CATEGORY_ID)?.id ?? categories[0]?.id ?? DEFAULT_CATEGORY_ID;
    setDraftState(newDraft({ meUid: user.uid, memberUids: options.map((o) => o.uid), today: today(), categoryId }));
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
        body: { ...toBody(draft), ...(confirmDuplicate ? { confirmDuplicate: true } : {}) },
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
      <h1 className="text-2xl font-semibold">Nuevo gasto</h1>
      <p className="text-sm text-slate-600">
        {trip.name} · Moneda {trip.currency}
      </p>
      <ExpenseForm
        currency={trip.currency}
        members={options}
        categories={categories}
        draft={draft}
        setDraft={setDraft}
        evaluation={evaluation}
        saving={saving}
        onSubmit={() => void save()}
        itemsSection={
          <>
            <ItemsEditor draft={draft} setDraft={setDraft} currency={trip.currency} members={options} issues={evaluation.issues} />
            <AdjustmentsEditor draft={draft} setDraft={setDraft} currency={trip.currency} members={options} />
          </>
        }
        payersSection={<PayersEditor draft={draft} setDraft={setDraft} currency={trip.currency} members={options} />}
      >
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
