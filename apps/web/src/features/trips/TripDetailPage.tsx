import { CalendarBlankIcon, CaretLeftIcon, LockSimpleIcon, PencilSimpleIcon, SuitcaseRollingIcon, TagIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { StatsResponse } from 'contracts';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { Banner } from '../../components/ui/Banner';
import { buttonClass } from '../../components/ui/Button';
import { Card, Section } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Segmented';
import { api } from '../../lib/apiClient';
import { formatDateRange, formatMoney } from '../../lib/format';
import { ExpiringNotice } from '../attachments/ExpiringNotice';
import { useCurrentUser } from '../auth/AuthProvider';
import { BalancesPanel } from '../balances/BalancesPanel';
import { DashboardPanel } from '../dashboard/DashboardPanel';
import { ExpenseList } from '../expenses/ExpenseList';
import type { SavedFlash } from '../expenses/NewExpensePage';
import { ExportMenu } from '../export/ExportMenu';
import { MembersPanel } from '../members/MembersPanel';
import { RequiresOnline } from '../offline/RequiresOnline';
import { tripAccessFor } from '../offline/runtime';
import { RoastPanel } from '../roast/RoastPanel';
import { SpicyModeToggle } from '../roast/SpicyModeToggle';
import { SettlementsPanel } from '../settlements/SettlementsPanel';
import { EditTripForm } from './EditTripForm';
import { AddExpenseFab } from './QuickActions';
import { StatusBadge } from './status';
import { ReadOnlyBanner, TripStatusActions } from './TripStatusActions';
import { useTrip, type LiveMember, type LiveTrip } from './useTrip';

const TABS = [
  { value: 'gastos', label: 'Gastos' },
  { value: 'saldos', label: 'Saldos' },
  { value: 'resumen', label: 'Resumen' },
] as const;
type Tab = (typeof TABS)[number]['value'];

/** Tricount-style hero: who the trip is, plus the two figures people look for first. */
function TripHero({ trip, members, myRole }: { trip: LiveTrip; members: LiveMember[]; myRole: string }) {
  const stats = useQuery({
    queryKey: ['stats', trip.id, trip.version, myRole],
    queryFn: () => api<StatsResponse>('GET', `/trips/${trip.id}/stats`),
    meta: { persist: true },
    enabled: trip.status !== 'pending',
  });
  const people = members.filter((m) => m.invitationStatus === 'accepted').length;
  const balance = stats.data?.me.balanceMinor ?? 0;
  return (
    <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 px-5 pb-5 pt-4 text-white shadow-fab">
      <SuitcaseRollingIcon aria-hidden size={140} weight="duotone" className="pointer-events-none absolute -bottom-8 -right-6 text-white/10" />
      <div className="relative space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="-ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-brand-50 hover:bg-white/10">
            <CaretLeftIcon size={18} weight="bold" />
            Mis viajes
          </Link>
          <StatusBadge status={trip.status} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{trip.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-brand-50">
            <span className="inline-flex items-center gap-1">
              <CalendarBlankIcon size={16} />
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
            <span className="inline-flex items-center gap-1">
              Moneda {trip.currency}
              {trip.currencyLocked && <LockSimpleIcon size={14} aria-hidden={false} aria-label="moneda bloqueada" role="img" />}
            </span>
            <span>
              {people} {people === 1 ? 'persona' : 'personas'}
            </span>
          </p>
        </div>
        {trip.status !== 'pending' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
              <p className="text-xs text-brand-50">Total del viaje</p>
              <p className="amount text-lg font-bold">{stats.data ? formatMoney(stats.data.sharedTotalMinor, trip.currency) : '—'}</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
              <p className="text-xs text-brand-50">{balance > 0 ? 'Te deben' : balance < 0 ? 'Debes' : 'Tu saldo'}</p>
              <p className="amount text-lg font-bold">
                {stats.data ? (balance === 0 ? 'Al día' : formatMoney(Math.abs(balance), trip.currency)) : '—'}
              </p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export function TripDetailPage() {
  const { tripId = '' } = useParams();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.some((t) => t.value === requested) ? (requested as Tab) : 'gastos';
  const opened = !!trip;
  // Feature 005: trips opened in the last 30 days stay available offline.
  useEffect(() => {
    if (opened) void tripAccessFor(user.uid).touch(tripId);
  }, [opened, tripId, user.uid]);
  const flash = (useLocation().state as { flash?: SavedFlash } | null)?.flash;

  if (loading || trip === undefined) return <Spinner />;
  if (trip === null) return <NotFound />;
  const me = members.find((m) => m.uid === user.uid);
  if (!me) return <Spinner />;
  const canEdit = (me.role === 'creator' || me.role === 'admin') && (trip.status === 'pending' || trip.status === 'active');
  const pendingTrip = trip.status === 'pending';

  const settings = (
    <Section title="Ajustes del viaje" id="trip-settings-title">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {canEdit && !editing && (
            <RequiresOnline label="Editar datos del viaje">
              <button type="button" onClick={() => setEditing(true)} className={buttonClass('secondary', 'sm')}>
                <PencilSimpleIcon size={16} />
                Editar datos del viaje
              </button>
            </RequiresOnline>
          )}
          {!pendingTrip && (
            <Link to={`/trips/${trip.id}/categories`} className={buttonClass('secondary', 'sm')}>
              <TagIcon size={16} />
              Categorías
            </Link>
          )}
        </div>
        {editing && <EditTripForm trip={trip} myRole={me.role} onDone={() => setEditing(false)} />}
        {canEdit && <SpicyModeToggle trip={trip} />}
        <TripStatusActions trip={trip} role={me.role} />
      </Card>
    </Section>
  );

  return (
    <div className={`space-y-5 ${trip.status === 'active' ? 'pb-36' : ''}`}>
      <TripHero trip={trip} members={members} myRole={me.role} />
      <ReadOnlyBanner trip={trip} />
      {pendingTrip && (
        <Banner tone="warning">
          El viaje se activará cuando todos los invitados acepten. Hasta entonces no se pueden registrar gastos.
          <span className="mt-1 block text-amber-800">Registro manual disponible cuando todos acepten la invitación.</span>
        </Banner>
      )}
      {flash && (
        <Banner tone="success" role="status">
          <p className="font-medium">{flash.message}</p>
          {flash.chargesByMember && (
            <p>
              Reparto guardado:{' '}
              {Object.entries(flash.chargesByMember)
                .map(([uid, c]) => `${members.find((m) => m.uid === uid)?.displayName ?? '—'} ${formatMoney(c.netMinor, trip.currency)}`)
                .join(' · ')}
            </p>
          )}
        </Banner>
      )}
      <ExpiringNotice tripId={trip.id} />

      {pendingTrip ? (
        <div className="space-y-6">
          <MembersPanel trip={trip} members={members} myRole={me.role} />
          {settings}
        </div>
      ) : (
        <>
          <div className="sticky top-16 z-10 -mx-4 bg-canvas/95 px-4 py-2 backdrop-blur">
            <Segmented
              label="Secciones del viaje"
              value={tab}
              options={TABS}
              full
              idPrefix="trip"
              onChange={(t) => setParams({ tab: t }, { replace: true })}
            />
          </div>
          <div role="tabpanel" id="trip-panel" aria-labelledby={`trip-tab-${tab}`} className="space-y-6">
            {tab === 'gastos' && <ExpenseList trip={trip} members={members} myRole={me.role} uid={user.uid} />}
            {tab === 'saldos' && (
              <>
                <BalancesPanel trip={trip} members={members} />
                {trip.spicyMode === true && <RoastPanel trip={trip} members={members} />}
                <SettlementsPanel trip={trip} members={members} />
              </>
            )}
            {tab === 'resumen' && (
              <>
                <DashboardPanel trip={trip} members={members} />
                <MembersPanel trip={trip} members={members} myRole={me.role} />
                <ExportMenu tripId={trip.id} />
                {settings}
              </>
            )}
          </div>
        </>
      )}
      <AddExpenseFab trip={trip} />
    </div>
  );
}
