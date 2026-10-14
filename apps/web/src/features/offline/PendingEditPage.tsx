import type { Member } from 'finance-engine';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { useCurrentUser } from '../auth/AuthProvider';
import { AdjustmentsEditor } from '../expenses/AdjustmentsEditor';
import { fromExpense } from '../expenses/expenseEditModel';
import { evaluate, toBody, type ExpenseDraft } from '../expenses/expenseFormModel';
import { ExpenseForm } from '../expenses/ExpenseForm';
import { ItemsEditor } from '../expenses/ItemsEditor';
import { PayersEditor } from '../expenses/PayersEditor';
import { useCategories, type ExpenseView } from '../expenses/useExpenses';
import { useTrip } from '../trips/useTrip';
import type { PendingExpense } from './outbox';
import { pendingReason } from './PendingList';
import { outboxFor } from './runtime';

/** FR-003a: the author corrects a pending expense (online or offline); the key is kept. */
export function PendingEditPage() {
  const { localId = '' } = useParams();
  const { user } = useCurrentUser();
  const [pending, setPending] = useState<PendingExpense | null | undefined>(undefined);
  useEffect(() => {
    void outboxFor(user.uid)
      .get(localId)
      .then((p) => setPending(p ?? null));
  }, [localId, user.uid]);

  if (pending === undefined) return <Spinner />;
  if (pending === null) return <NotFound />;
  if (!pending.recoverable) return <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Este gasto solo se puede descartar.</p>;
  return <PendingEditForm pending={pending} />;
}

function PendingEditForm({ pending }: { pending: PendingExpense }) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(pending.tripId);
  const { all: categories } = useCategories(pending.tripId);
  const [draft, setDraftState] = useState<ExpenseDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accepted = members.filter((m) => m.invitationStatus === 'accepted' && m.uid);
  const options = accepted.map((m) => ({ uid: m.uid!, name: m.displayName ?? m.email }));
  const engineMembers: Member[] = accepted.map((m) => ({ uid: m.uid!, joinOrder: m.joinOrder ?? 0 }));

  if (draft === null) setDraftState(fromExpense(pending.input as unknown as ExpenseView));
  const evaluation = useMemo(
    () => (draft && trip ? evaluate(draft, engineMembers, trip.expenseSeq + 1) : null),
    [draft, trip?.expenseSeq, accepted.length],
  );

  if (loading || trip === undefined) return <Spinner />;
  if (trip === null) return <NotFound />;
  if (!draft || !evaluation) return <Spinner />;
  const setDraft = (u: (d: ExpenseDraft) => ExpenseDraft) => setDraftState((d) => (d ? u(d) : d));
  const usable = categories.filter((c) => c.active || c.id === pending.input.categoryId);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await outboxFor(user.uid).update(pending.localId, toBody(draft));
      navigate('/pending');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Corregir gasto pendiente</h1>
      <p className="text-sm text-slate-600">
        {trip.name} · Moneda {trip.currency}
      </p>
      {pending.error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">Motivo del rechazo: {pendingReason(pending)}</p>}
      <ExpenseForm
        currency={trip.currency}
        members={options}
        categories={usable}
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
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </ExpenseForm>
    </div>
  );
}
