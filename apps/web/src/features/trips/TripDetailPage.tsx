import { useState } from 'react';
import { formatMoney } from '../../lib/format';
import type { SavedFlash } from '../expenses/NewExpensePage';
import { Link, useLocation, useParams } from 'react-router';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { formatDateRange } from '../../lib/format';
import { useCurrentUser } from '../auth/AuthProvider';
import { BalancesPanel } from '../balances/BalancesPanel';
import { DashboardPanel } from '../dashboard/DashboardPanel';
import { MembersPanel } from '../members/MembersPanel';
import { EditTripForm } from './EditTripForm';
import { QuickActions } from './QuickActions';
import { StatusBadge } from './status';
import { ReadOnlyBanner, TripStatusActions } from './TripStatusActions';
import { useTrip } from './useTrip';

export function TripDetailPage() {
  const { tripId = '' } = useParams();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const [editing, setEditing] = useState(false);
  const flash = (useLocation().state as { flash?: SavedFlash } | null)?.flash;

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
      {flash && (
        <div role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="font-medium">{flash.message}</p>
          {flash.chargesByMember && (
            <p>
              Reparto guardado:{' '}
              {Object.entries(flash.chargesByMember)
                .map(([uid, c]) => `${members.find((m) => m.uid === uid)?.displayName ?? '—'} ${formatMoney(c.netMinor, trip.currency)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}
      <QuickActions trip={trip} />
      {trip.status !== 'pending' && (
        <nav aria-label="Secciones del viaje" className="flex gap-4 text-sm font-medium">
          <Link to={`/trips/${trip.id}/expenses`} className="text-brand-800 underline">
            Ver gastos
          </Link>
          <Link to={`/trips/${trip.id}/categories`} className="text-brand-800 underline">
            Categorías
          </Link>
        </nav>
      )}
      <TripStatusActions trip={trip} role={me.role} />
      {editing && <EditTripForm trip={trip} myRole={me.role} onDone={() => setEditing(false)} />}
      {trip.status !== 'pending' && <DashboardPanel trip={trip} members={members} />}
      {trip.status !== 'pending' && <BalancesPanel trip={trip} members={members} />}
      <MembersPanel trip={trip} members={members} myRole={me.role} />
    </div>
  );
}
