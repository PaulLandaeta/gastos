import { buttonClass } from '../../components/ui/Button';
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
import { localProblem } from '../attachments/AttachmentPicker';
import { ACCEPT, attachFiles } from '../attachments/upload';
import { useTrip } from '../trips/useTrip';

/** FR-001/FR-005: register a payment (optionally prefilled from the simplified proposal). */
export function PaySettlementPage() {
  const { tripId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const isManager = ['creator', 'admin'].includes(members.find((m) => m.uid === user.uid)?.role ?? '');
  // Feature 006 (FR-009): a manager can register a payment on behalf of a deleted participant.
  const deletedPayers = isManager ? members.filter((m) => m.invitationStatus === 'accepted' && m.uid && m.deletedAt) : [];
  const [fromUid, setFromUid] = useState(params.get('from') ?? user.uid);
  const others = members.filter((m) => m.invitationStatus === 'accepted' && m.uid && m.uid !== fromUid && (fromUid === user.uid || !m.deletedAt));
  const [toUid, setToUid] = useState(params.get('to') ?? '');
  const [amount, setAmount] = useState<number | null>(params.get('amount') ? Number(params.get('amount')) : null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [proof, setProof] = useState<File[]>([]);
  const key = useRef(crypto.randomUUID());

  if (loading || trip === undefined) return <Spinner />;
  if (trip === null) return <NotFound />;
  const receiver = others.some((m) => m.uid === toUid) ? toUid : (others[0]?.uid ?? '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!receiver || !amount) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ settlement: SettlementDto; exceedsDebt: boolean }>('POST', `/trips/${tripId}/settlements`, {
        body: { toUid: receiver, amountMinor: amount, ...(note.trim() ? { note } : {}), ...(fromUid !== user.uid ? { fromUid } : {}) },
        idempotencyKey: key.current,
      });
      let proofFailed = false;
      if (proof.length > 0) {
        try {
          await attachFiles(tripId, proof, { settlementId: res.settlement.id });
        } catch {
          proofFailed = true;
        }
      }
      navigate(`/trips/${tripId}?tab=saldos`, {
        state: {
          flash: {
            message:
              (res.exceedsDebt
                ? 'Pago registrado: pendiente de confirmación (supera la deuda actual).'
                : 'Pago registrado: pendiente de confirmación.') +
              (proofFailed ? ' No se pudo subir el comprobante; puedes adjuntarlo desde la lista de pagos.' : ''),
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
      <h1 className="text-2xl font-bold tracking-tight">Registrar pago</h1>
      <p className="text-sm text-slate-600">El pago queda pendiente hasta que la otra persona lo confirme. Solo los pagos confirmados cambian los saldos.</p>
      {deletedPayers.length > 0 && (
        <Field id="pay-from" label="¿Quién pagó?">
          <select id="pay-from" className={inputClass} value={fromUid} onChange={(e) => setFromUid(e.target.value)}>
            <option value={user.uid}>Yo</option>
            {deletedPayers.map((m) => (
              <option key={m.uid} value={m.uid!}>
                {m.displayName}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="pay-to" label={fromUid === user.uid ? '¿A quién pagaste?' : '¿A quién pagó?'}>
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
      <Field id="pay-proof" label="Comprobante (opcional)">
        <input
          id="pay-proof"
          type="file"
          multiple
          accept={ACCEPT}
          className="block w-full text-sm"
          onChange={(e) => setProof([...(e.target.files ?? [])])}
        />
      </Field>
      {localProblem(proof) && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {localProblem(proof)}
        </p>
      )}
      <ErrorMessage error={error} />
      <button type="submit" disabled={saving || !amount || !receiver || !!localProblem(proof)} className={buttonClass('primary', 'lg', 'w-full')}>
        {saving ? 'Registrando…' : 'Registrar pago'}
      </button>
    </form>
  );
}
