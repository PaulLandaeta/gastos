import { FireIcon } from '@phosphor-icons/react';
import { Avatar } from '../../components/ui/Avatar';
import { cardClass } from '../../components/ui/Card';
import { PressedGroup } from '../../components/ui/Segmented';
import { useQuery } from '@tanstack/react-query';
import type { BalancesResponse } from 'contracts';
import { roastRanking, type Member } from 'finance-engine';
import { useMemo, useState } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/apiClient';
import { formatMoney } from '../../lib/format';
import type { LiveMember, LiveTrip } from '../trips/useTrip';
import { ROAST_LABELS, roastSentence } from './roastCopy';

/** Feature 007 (RF-57): shown only when the trip's spicy mode is on; presentation only. */
export function RoastPanel({ trip, members }: { trip: LiveTrip; members: LiveMember[] }) {
  // Transitive = the simplified proposal (A→B→C becomes A→C); direct = the original pairwise debts.
  const [view, setView] = useState<'simplified' | 'original'>('simplified');
  const { data, error, isLoading } = useQuery({
    // Same key as BalancesPanel: both cards share the cached balances.
    queryKey: ['balances', trip.id, view, trip.version],
    queryFn: () => api<BalancesResponse>('GET', `/trips/${trip.id}/balances`, { query: { view } }),
    meta: { persist: true },
  });
  const order = useMemo<Member[]>(
    () => members.flatMap((m) => (m.uid ? [{ uid: m.uid, joinOrder: m.joinOrder ?? Number.MAX_SAFE_INTEGER }] : [])),
    [members],
  );
  const name = (uid: string) => {
    const m = members.find((x) => x.uid === uid);
    return m?.displayName ?? m?.email ?? 'Participante';
  };
  const ranking = data ? roastRanking(data.netByMember, data.transfers, order) : [];

  return (
    <section aria-labelledby="roast-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="roast-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <FireIcon weight="fill" className="text-orange-500" />
          Ranking del grupo
        </h2>
        <PressedGroup
          label="Vista del ranking"
          value={view}
          onChange={setView}
          options={[
            { value: 'simplified', label: 'Transitiva' },
            { value: 'original', label: 'Directa' },
          ]}
        />
      </div>
      {isLoading && <Spinner label="Calculando el ranking…" />}
      <ErrorMessage error={error} />
      {data && (
        <ol className={`${cardClass} divide-y divide-slate-100`}>
          {ranking.map((e) => (
            <li key={e.uid} className="space-y-1 p-3">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <Avatar name={name(e.uid)} seed={e.uid} size="sm" />
                  {name(e.uid)}
                </span>
                <span className={e.tier === 'macho' ? 'text-sm font-semibold text-emerald-800' : 'text-sm font-semibold text-red-800'}>
                  {ROAST_LABELS[e.tier]}
                </span>
              </p>
              <p className="text-sm text-slate-700">{roastSentence(e, name, data.currency)}</p>
              {e.owes.length > 0 && (
                <ul className="text-sm text-slate-700">
                  {e.owes.map((o) => (
                    <li key={o.toUid}>
                      {name(e.uid)} es la zorra de {name(o.toUid)} ({formatMoney(o.amountMinor, data.currency)})
                      {o.toUid === e.mainOwnerUid && e.owes.length > 1 && <strong> · dueño principal</strong>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
