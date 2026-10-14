import { useState } from 'react';
import { useParams } from 'react-router';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { formatDateRange } from '../../lib/format';
import { useCurrentUser } from '../auth/AuthProvider';
import { BalancesPanel } from '../balances/BalancesPanel';
import { MembersPanel } from '../members/MembersPanel';
import { EditTripForm } from './EditTripForm';
import { StatusBadge } from './status';
import { ReadOnlyBanner, TripStatusActions } from './TripStatusActions';
import { useTrip } from './useTrip';

export function TripDetailPage() {
  const { tripId = '' } = useParams();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const [editing, setEditing] = useState(false);

  if (loading || trip === undefined) return <Spinner />;
  if (trip === null) return <NotFound />;
  const me = members.find((m) => m.uid === user.uid);
  if (!me) return <Spinner />;
  const canEdit = (me.role === 'creator' || me.role === 'admin') && (trip.status === 'pending' || trip.status === 'active');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{trip.name}</h1>
          <StatusBadge status={trip.status} />
        </div>
        <p className="text-slate-600">
          {formatDateRange(trip.startDate, trip.endDate)} · Moneda {trip.currency}
          {trip.currencyLocked && <span aria-label="moneda bloqueada"> 🔒</span>}
        </p>
        <ReadOnlyBanner trip={trip} />
        {trip.status === 'pending' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            El viaje se activará cuando todos los invitados acepten. Hasta entonces no se pueden registrar gastos.
          </p>
        )}
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-sm text-brand-700 underline">
            Editar datos del viaje
          </button>
        )}
      </header>
      <TripStatusActions trip={trip} role={me.role} />
      {editing && <EditTripForm trip={trip} myRole={me.role} onDone={() => setEditing(false)} />}
      {trip.status !== 'pending' && <BalancesPanel trip={trip} members={members} />}
      <MembersPanel trip={trip} members={members} myRole={me.role} />
    </div>
  );
}
