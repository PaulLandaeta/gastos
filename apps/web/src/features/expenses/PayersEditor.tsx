import { MoneyInput } from '../../components/MoneyInput';
import type { ExpenseDraft } from './expenseFormModel';
import type { MemberOption } from './MemberChips';

/** RF-07/RF-32: one or several payers, only trip participants, amounts must add up. */
export function PayersEditor({
  draft,
  setDraft,
  currency,
  members,
}: {
  draft: ExpenseDraft;
  setDraft: (u: (d: ExpenseDraft) => ExpenseDraft) => void;
  currency: string;
  members: MemberOption[];
}) {
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.name ?? uid;
  const used = new Set(draft.payers.map((p) => p.uid));
  const setPayer = (index: number, patch: Partial<{ uid: string; amountMinor: number | null }>) =>
    setDraft((d) => ({ ...d, payers: d.payers.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {draft.payers.map((p, index) => (
          <li key={index} className="grid grid-cols-[1fr_9rem_auto] items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium text-slate-800">Pagador {index + 1}</span>
              <select
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                value={p.uid}
                onChange={(e) => setPayer(index, { uid: e.target.value })}
              >
                {members
                  .filter((m) => m.uid === p.uid || !used.has(m.uid))
                  .map((m) => (
                    <option key={m.uid} value={m.uid}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            <MoneyInput
              label={`Aporte de ${nameOf(p.uid)}`}
              currency={currency}
              valueMinor={p.amountMinor}
              onChange={(v) => setPayer(index, { amountMinor: v })}
            />
            {draft.payers.length > 1 && (
              <button
                type="button"
                className="pb-2 text-sm text-red-700 underline"
                onClick={() => setDraft((d) => ({ ...d, payers: d.payers.filter((_, i) => i !== index) }))}
              >
                Quitar
              </button>
            )}
          </li>
        ))}
      </ul>
      {draft.payers.length < members.length && (
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          onClick={() =>
            setDraft((d) => {
              const next = members.find((m) => !d.payers.some((p) => p.uid === m.uid));
              return next ? { ...d, payers: [...d.payers, { uid: next.uid, amountMinor: null }] } : d;
            })
          }
        >
          Añadir pagador
        </button>
      )}
    </div>
  );
}
