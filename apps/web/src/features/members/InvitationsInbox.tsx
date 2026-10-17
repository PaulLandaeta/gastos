import { buttonClass } from '../../components/ui/Button';
import { normalizeEmail, type InvitationIndex } from 'contracts';
import { useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { api } from '../../lib/apiClient';
import { formatDateRange } from '../../lib/format';
import { useCollection } from '../../lib/useFirestore';
import { useCurrentUser } from '../auth/AuthProvider';

export function InvitationsInbox() {
  const { user } = useCurrentUser();
  const email = user.email ? normalizeEmail(user.email) : null;
  const { data } = useCollection<InvitationIndex>(email && user.emailVerified ? `invitations/${email}/trips` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (!data || data.length === 0) return null;

  async function answer(tripId: string, action: 'accept' | 'decline') {
    setBusy(tripId);
    setError(null);
    try {
      await api('POST', `/trips/${tripId}/invitations/${action}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="invitations-title" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h2 id="invitations-title" className="text-lg font-semibold tracking-tight">
        Invitaciones
      </h2>
      <ErrorMessage error={error} />
      <ul className="space-y-3">
        {data.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3">
            <div>
              <p className="font-medium">{inv.tripName}</p>
              <p className="text-sm text-slate-600">
                {formatDateRange(inv.startDate, inv.endDate)} · {inv.currency} · invita {inv.inviterDisplayName}
              </p>
              {inv.status === 'declined' && <p className="text-sm text-slate-600">Rechazaste esta invitación.</p>}
            </div>
            {inv.status === 'invited' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy === inv.tripId}
                  onClick={() => void answer(inv.tripId, 'decline')}
                  className={buttonClass('secondary', 'sm')}
                >
                  Rechazar
                </button>
                <button
                  type="button"
                  disabled={busy === inv.tripId}
                  onClick={() => void answer(inv.tripId, 'accept')}
                  className={buttonClass('primary', 'sm')}
                >
                  Aceptar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
