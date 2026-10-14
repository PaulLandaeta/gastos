import type { SettlementDto } from 'contracts';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, inputClass } from '../../components/Field';
import { MoneyInput } from '../../components/MoneyInput';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { ApiError, api } from '../../lib/apiClient';
import { useCurrentUser } from '../auth/AuthProvider';
import { useTrip } from '../trips/useTrip';

/** FR-001/FR-005: register a payment (optionally prefilled from the simplified proposal). */
export function PaySettlementPage() {
  const { tripId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const others = members.filter((m) => m.invitationStatus === 'accepted' && m.uid && m.uid !== user.uid);
  const [toUid, setToUid] = useState(params.get('to') ?? '');
  const [amount, setAmount] = useState<number | null>(params.get('amount') ? Number(params.get('amount')) : null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef(crypto.randomUUID());

  if (loading || trip === undefined) return <Spinner />;
  if (trip === null) return <NotFound />;
  const receiver = toUid || others[0]?.uid || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!receiver || !amount) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ settlement: SettlementDto; exceedsDebt: boolean }>('POST', `/trips/${tripId}/settlements`, {
        body: { toUid: receiver, amountMinor: amount, ...(note.trim() ? { note } : {}) },
        idempotencyKey: key.current,
      });
      navigate(`/trips/${tripId}`, {
        state: {
          flash: {
            message: res.exceedsDebt
              ? 'Pago registrado: pendiente de confirmación (supera la deuda actual).'
              : 'Pago registrado: pendiente de confirmación.',
          },
        },
      });
    } catch (err) {
      setError(err);
      if (!(err instanceof ApiError && err.code === 'NETWORK')) key.current = crypto.randomUUID();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-2xl font-semibold">Registrar pago</h1>
      <p className="text-sm text-slate-600">El pago queda pendiente hasta que la otra persona lo confirme. Solo los pagos confirmados cambian los saldos.</p>
      <Field id="pay-to" label="¿A quién pagaste?">
        <select id="pay-to" className={inputClass} value={receiver} onChange={(e) => setToUid(e.target.value)}>
          {others.map((m) => (
            <option key={m.uid} value={m.uid!}>
              {m.displayName ?? m.email}
            </option>
          ))}
        </select>
      </Field>
      <MoneyInput id="pay-amount" label="Importe pagado" currency={trip.currency} valueMinor={amount} onChange={setAmount} required />
      <Field id="pay-note" label="Nota (opcional)">
        <input id="pay-note" maxLength={200} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorMessage error={error} />
      <button type="submit" disabled={saving || !amount || !receiver} className="w-full rounded-xl bg-brand-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
        {saving ? 'Registrando…' : 'Registrar pago'}
      </button>
    </form>
  );
}
