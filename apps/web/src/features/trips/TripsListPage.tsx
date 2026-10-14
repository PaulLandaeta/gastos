import type { TripStatus, UserTripIndex } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { Spinner } from '../../components/Spinner';
import { formatDateRange } from '../../lib/format';
import { useCollection } from '../../lib/useFirestore';
import { useCurrentUser } from '../auth/AuthProvider';
import { InvitationsInbox } from '../members/InvitationsInbox';
import { StatusBadge } from './status';

const GROUPS: { status: TripStatus; title: string }[] = [
  { status: 'active', title: 'Activos' },
  { status: 'pending', title: 'Pendientes de aceptación' },
  { status: 'closed', title: 'Cerrados' },
];

type IndexDoc = UserTripIndex & { id: string };

function TripGroup({ title, trips }: { title: string; trips: IndexDoc[] }) {
  if (trips.length === 0) return null;
  const id = `group-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <ul className="space-y-2">
        {trips.map((t) => (
          <li key={t.id}>
            <Link
              to={`/trips/${t.tripId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 hover:border-brand-600"
            >
              <span>
                <span className="block font-medium">{t.name}</span>
                <span className="block text-sm text-slate-600">
                  {formatDateRange(t.startDate, t.endDate)} · {t.currency}
                </span>
              </span>
              <StatusBadge status={t.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TripsListPage() {
  const { user } = useCurrentUser();
  const { data, loading } = useCollection<UserTripIndex>(`users/${user.uid}/trips`);
  const [showArchived, setShowArchived] = useState(false);
  const trips = [...(data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const archived = trips.filter((t) => t.status === 'archived');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Mis viajes</h1>
        <Link to="/trips/new" className="rounded-xl bg-brand-700 px-4 py-2 font-medium text-white">
          Nuevo viaje
        </Link>
      </div>
      <InvitationsInbox />
      {loading && <Spinner />}
      {!loading && trips.length === 0 && (
        <p className="text-slate-600">Todavía no tienes viajes. Crea uno e invita a tus compañeros.</p>
      )}
      {GROUPS.map((g) => (
        <TripGroup key={g.status} title={g.title} trips={trips.filter((t) => t.status === g.status)} />
      ))}
      {archived.length > 0 && (
        <div className="space-y-2">
          <button type="button" className="text-sm text-brand-700 underline" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? 'Ocultar archivados' : `Ver archivados (${archived.length})`}
          </button>
          {showArchived && <TripGroup title="Archivados" trips={archived} />}
        </div>
      )}
    </div>
  );
}
