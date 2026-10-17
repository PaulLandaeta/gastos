import { ArrowRightIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { BalancesResponse } from 'contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/AuthProvider';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/apiClient';
import { formatMoney } from '../../lib/format';
import type { LiveMember, LiveTrip } from '../trips/useTrip';
import { RequiresOnline } from '../offline/RequiresOnline';
import { Avatar } from '../../components/ui/Avatar';
import { buttonClass } from '../../components/ui/Button';
import { cardClass } from '../../components/ui/Card';
import { PressedGroup } from '../../components/ui/Segmented';

type View = 'original' | 'simplified';

export function BalancesPanel({ trip, members }: { trip: LiveTrip; members: LiveMember[] }) {
  const [view, setView] = useState<View>('simplified');
  const { user } = useCurrentUser();
  const { data, error, isLoading } = useQuery({
    // trip.version changes with every expense, so balances refresh automatically.
    queryKey: ['balances', trip.id, view, trip.version],
    queryFn: () => api<BalancesResponse>('GET', `/trips/${trip.id}/balances`, { query: { view } }),
    // Feature 005: kept for offline reading (≤ 30 days, per account).
    meta: { persist: true },
  });
  const name = (uid: string) => {
    const m = members.find((x) => x.uid === uid);
    return m?.displayName ?? m?.email ?? 'Participante';
  };

  const maxAbs = Math.max(1, ...(data?.netByMember.map((b) => Math.abs(b.netMinor)) ?? [1]));

  return (
    <section aria-labelledby="balances-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="balances-title" className="text-lg font-semibold tracking-tight">
          Saldos
        </h2>
        <PressedGroup
          label="Vista de deudas"
          value={view}
          onChange={setView}
          options={[
            { value: 'simplified', label: 'Vista simplificada' },
            { value: 'original', label: 'Vista original' },
          ]}
        />
      </div>
      {isLoading && <Spinner label="Calculando saldos…" />}
      <ErrorMessage error={error} />
      {data && (
        <>
          <ul className={`${cardClass} divide-y divide-slate-100`}>
            {data.netByMember.map((b) => {
              const tone = b.netMinor > 0 ? 'text-positive' : b.netMinor < 0 ? 'text-negative' : 'text-slate-500';
              const width = `${Math.max(3, (Math.abs(b.netMinor) / maxAbs) * 50)}%`;
              return (
                <li key={b.uid} className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={name(b.uid)} seed={b.uid} />
                      <span className="truncate font-medium">
                        {name(b.uid)}
                        {b.uid === user.uid && <span className="font-normal text-slate-500"> (tú)</span>}
                      </span>
                    </span>
                    <span className={`amount shrink-0 text-right text-sm font-semibold ${tone}`}>
                      {b.netMinor > 0 ? 'le deben ' : b.netMinor < 0 ? 'debe ' : ''}
                      {formatMoney(Math.abs(b.netMinor), data.currency)}
                    </span>
                  </div>
                  {/* Diverging bar from the center: green right (is owed), red left (owes). */}
                  <div aria-hidden className="relative h-1.5 rounded-full bg-slate-100">
                    <span className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                    {b.netMinor !== 0 && (
                      <span
                        className={`absolute inset-y-0 rounded-full ${b.netMinor > 0 ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-rose-500'}`}
                        style={{ width }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <h3 className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {view === 'simplified' ? 'Transferencias propuestas' : 'Deudas entre participantes'}
          </h3>
          {data.transfers.length === 0 ? (
            <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
              <CheckCircleIcon weight="fill" className="text-emerald-600" />
              No hay deudas pendientes.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.transfers.map((t) => (
                <li key={`${t.fromUid}>${t.toUid}`} className={`${cardClass} flex flex-wrap items-center justify-between gap-3 p-3 text-sm`}>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Avatar name={name(t.fromUid)} seed={t.fromUid} size="sm" />
                    <span className="font-medium">{name(t.fromUid)}</span>
                    <ArrowRightIcon aria-hidden={false} role="img" aria-label="paga a" className="text-slate-400" />
                    <Avatar name={name(t.toUid)} seed={t.toUid} size="sm" />
                    <span className="font-medium">{name(t.toUid)}</span>
                    <strong className="amount text-slate-900">{formatMoney(t.amountMinor, data.currency)}</strong>
                  </span>
                  {t.fromUid === user.uid && trip.status === 'active' && (
                    <RequiresOnline label="Pagar" className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600">
                      <Link
                        to={`/trips/${trip.id}/settlements/new?to=${t.toUid}&amount=${t.amountMinor}`}
                        aria-label={`Pagar ${formatMoney(t.amountMinor, data.currency)} a ${name(t.toUid)}`}
                        className={buttonClass('primary', 'sm')}
                      >
                        Pagar
                      </Link>
                    </RequiresOnline>
                  )}
                </li>
              ))}
            </ul>
          )}
          {view === 'simplified' && <p className="px-1 text-xs text-slate-600">Es solo una propuesta: no registra pagos ni cambia los gastos.</p>}
        </>
      )}
    </section>
  );
}
