import { buttonClass } from '../../components/ui/Button';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { RefundableResponse } from 'contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { ApiError, api } from '../../lib/apiClient';
import { formatMoney } from '../../lib/format';

/** RF-37: refund (by units and/or amount) of one item, with a suggested amount and the max available. */
export function RefundForm({
  tripId,
  expenseId,
  itemId,
  itemName,
  currency,
  members,
  onDone,
}: {
  tripId: string;
  expenseId: string;
  itemId: string;
  itemName: string;
  currency: string;
  members: { uid: string; name: string }[];
  onDone: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [recipient, setRecipient] = useState(members[0]?.uid ?? '');
  const key = useRef(crypto.randomUUID());
  const refundable = useQuery({
    queryKey: ['refundable', tripId, expenseId, itemId, quantity],
    queryFn: () =>
      api<RefundableResponse>('GET', `/trips/${tripId}/expenses/${expenseId}/items/${itemId}/refundable`, { query: { quantity } }),
  });
  useEffect(() => {
    if (!touched && refundable.data) setAmount(refundable.data.suggestedMinor || null);
  }, [refundable.data, touched]);
  const save = useMutation({
    mutationFn: () =>
      api('POST', `/trips/${tripId}/expenses/${expenseId}/refunds`, {
        body: { itemId, quantity, amountMinor: amount, recipientUid: recipient },
        idempotencyKey: key.current,
      }),
    onSuccess: onDone,
    onError: (e) => {
      if (!(e instanceof ApiError && e.code === 'NETWORK')) key.current = crypto.randomUUID();
    },
  });
  const r = refundable.data;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (amount && recipient) save.mutate();
  }

  return (
    <form onSubmit={submit} aria-label={`Devolución de ${itemName}`} role="region" className="space-y-3 rounded-2xl border border-slate-200/70 bg-surface shadow-card bg-slate-50 p-3">
      {r && (
        <p className="text-sm text-slate-700">
          Máximo disponible: {formatMoney(r.maxMinor - r.refundedMinor, currency)} ({r.quantity - r.refundedQuantity} de {r.quantity} unidades)
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field id={`rq-${itemId}`} label="Unidades devueltas">
          <input
            id={`rq-${itemId}`}
            type="number"
            min={0}
            inputMode="numeric"
            className={inputClass}
            value={quantity}
            onChange={(e) => {
              setQuantity(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0));
              setTouched(false);
            }}
          />
        </Field>
        <MoneyInput
          id={`ra-${itemId}`}
          label="Importe devuelto"
          currency={currency}
          valueMinor={amount}
          onChange={(v) => {
            setAmount(v);
            setTouched(true);
          }}
        />
      </div>
      <Field id={`rr-${itemId}`} label="¿Quién recibió el dinero?">
        <select id={`rr-${itemId}`} className={inputClass} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
          {members.map((m) => (
            <option key={m.uid} value={m.uid}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <ErrorMessage error={save.error} />
      <button type="submit" disabled={save.isPending || !amount} className={buttonClass('primary', 'md')}>
        Registrar devolución
      </button>
    </form>
  );
}
