import type { PreviewResponse } from 'contracts';
import type { Member } from 'finance-engine';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { ApiError, api } from '../../lib/apiClient';
import { useDoc } from '../../lib/useFirestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { useTrip } from '../trips/useTrip';
import { AdjustmentsEditor } from './AdjustmentsEditor';
import { ConflictDiff } from './ConflictDiff';
import { diffDraft, fromExpense } from './expenseEditModel';
import { evaluate, toBody, type ExpenseDraft } from './expenseFormModel';
import { ExpenseForm } from './ExpenseForm';
import { ImpactPreview } from './ImpactPreview';
import { ItemsEditor } from './ItemsEditor';
import { PayersEditor } from './PayersEditor';
import { useCategories, type ExpenseView } from './useExpenses';

/** RF-10/RF-36: edit with the creation form and optimistic versioning. */
export function EditExpensePage() {
  const { tripId = '', expenseId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const { all: categories } = useCategories(tripId);
  const live = useDoc<Omit<ExpenseView, 'id'>>(`trips/${tripId}/expenses/${expenseId}`);
  const [draft, setDraftState] = useState<ExpenseDraft | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const accepted = members.filter((m) => m.invitationStatus === 'accepted' && m.uid);
  const engineMembers: Member[] = accepted.map((m) => ({ uid: m.uid!, joinOrder: m.joinOrder ?? 0 }));
  const current = live.data ? ({ ...live.data, id: expenseId } as ExpenseView) : null;
  // Feature 006: a deleted participant stays selectable only in the expenses they already were in.
  const involved = new Set([...(current?.payers ?? []).map((p) => p.uid), ...(current?.items ?? []).flatMap((i) => i.beneficiaries)]);
  const options = accepted
    .filter((m) => !m.deletedAt || involved.has(m.uid!))
    .map((m) => ({ uid: m.uid!, name: m.displayName ?? m.email }));

  if (current && draft === null) {
    setDraftState(fromExpense(current));
    setBaseVersion(current.version);
  }
  const evaluation = useMemo(
    () => (draft && current ? evaluate(draft, engineMembers, current.seq) : null),
    [draft, current?.seq, accepted.length],
  );

  if (loading || trip === undefined || live.loading) return <Spinner />;
  if (trip === null || !current || live.error) return <NotFound />;
  const me = members.find((m) => m.uid === user.uid);
  const allowed =
    current.status === 'active' && trip.status === 'active' && (current.createdBy === user.uid || me?.role === 'creator' || me?.role === 'admin');
  if (!allowed) return <p className="rounded-lg bg-amber-50 p-3 text-amber-900">No puedes editar este gasto.</p>;
  if (!draft || !evaluation || baseVersion === null) return <Spinner />;
  const setDraft = (u: (d: ExpenseDraft) => ExpenseDraft) => setDraftState((d) => (d ? u(d) : d));
  const usable = categories.filter((c) => c.active || c.id === current.categoryId);

  async function save(ledgerRevision?: number) {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await api('PUT', `/trips/${tripId}/expenses/${expenseId}`, {
        body: { ...toBody(draft), expectedVersion: baseVersion, ...(ledgerRevision !== undefined ? { expectedLedgerRevision: ledgerRevision } : {}) },
      });
      navigate(`/trips/${tripId}/expenses/${expenseId}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PREVIEW_REQUIRED') {
        setPreview((e.details as { preview: PreviewResponse }).preview);
      } else if (e instanceof ApiError && e.code === 'CONFLICT' && e.details && 'currentLedgerRevision' in e.details) {
        // Balances changed after the preview: recalculate it.
        setPreview(await api<PreviewResponse>('POST', `/trips/${tripId}/expenses/${expenseId}/preview`, { body: { action: 'edit', body: toBody(draft) } }));
      } else if (e instanceof ApiError && e.code === 'CONFLICT') setConflict(true);
      else setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Editar gasto</h1>
      <p className="text-sm text-slate-600">
        {trip.name} · Moneda {trip.currency} · versión {baseVersion}
      </p>
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
        <ErrorMessage error={error} />
        {preview && (
          <ImpactPreview
            preview={preview}
            currency={trip.currency}
            nameOf={(uid) => options.find((o) => o.uid === uid)?.name ?? 'Participante'}
            busy={saving}
            onConfirm={() => {
              const rev = preview.ledgerRevision;
              setPreview(null);
              void save(rev);
            }}
            onCancel={() => setPreview(null)}
          />
        )}
        {conflict && (
          <ConflictDiff
            fields={diffDraft(draft, current)}
            onReload={() => {
              setDraftState(fromExpense(current));
              setBaseVersion(current.version);
              setConflict(false);
            }}
            onKeep={() => {
              setBaseVersion(current.version);
              setConflict(false);
            }}
          />
        )}
      </ExpenseForm>
    </div>
  );
}
