import { CaretRightIcon, PlusIcon, SuitcaseRollingIcon } from '@phosphor-icons/react';
import type { TripStatus, UserTripIndex } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { Spinner } from '../../components/Spinner';
import { colorFor } from '../../components/ui/Avatar';
import { ButtonLink } from '../../components/ui/Button';
import { cardClass } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconCircle } from '../../components/ui/IconCircle';
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
      <h2 id={id} className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h2>
      <ul className="space-y-2">
        {trips.map((t) => (
          <li key={t.id}>
            <Link to={`/trips/${t.tripId}`} className={`${cardClass} flex items-center gap-3 p-4 transition-colors hover:border-brand-300`}>
              <IconCircle color={colorFor(t.tripId)} size="lg">
                <SuitcaseRollingIcon size={28} weight="fill" />
              </IconCircle>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">{t.name}</span>
                <span className="block text-sm text-slate-600">
                  {formatDateRange(t.startDate, t.endDate)} · {t.currency}
                </span>
                <span className="mt-1.5 block">
                  <StatusBadge status={t.status} />
                </span>
              </span>
              <CaretRightIcon className="shrink-0 text-slate-400" />
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
        <h1 className="text-2xl font-bold tracking-tight">Mis viajes</h1>
        <ButtonLink to="/trips/new" icon={<PlusIcon size={18} weight="bold" />}>
          Nuevo viaje
        </ButtonLink>
      </div>
      <InvitationsInbox />
      {loading && <Spinner />}
      {!loading && trips.length === 0 && (
        <EmptyState icon={<SuitcaseRollingIcon size={30} weight="duotone" />} title="Todavía no tienes viajes.">
          Crea uno e invita a tus compañeros.
        </EmptyState>
      )}
      {GROUPS.map((g) => (
        <TripGroup key={g.status} title={g.title} trips={trips.filter((t) => t.status === g.status)} />
      ))}
      {archived.length > 0 && (
        <div className="space-y-2">
          <button type="button" className="rounded-lg px-1 text-sm font-medium text-brand-800 hover:underline" onClick={() => setShowArchived((s) => !s)}>
            {showArchived ? 'Ocultar archivados' : `Ver archivados (${archived.length})`}
          </button>
          {showArchived && <TripGroup title="Archivados" trips={archived} />}
        </div>
      )}
    </div>
  );
}
