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

  return (
    <section aria-labelledby="balances-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="balances-title" className="text-lg font-semibold">
          Saldos
        </h2>
        <div role="group" aria-label="Vista de deudas" className="inline-flex rounded-lg border border-slate-300 p-0.5">
          {(['simplified', 'original'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="rounded-md px-3 py-1.5 text-sm aria-pressed:bg-brand-700 aria-pressed:text-white"
            >
              {v === 'simplified' ? 'Vista simplificada' : 'Vista original'}
            </button>
          ))}
        </div>
      </div>
      {isLoading && <Spinner label="Calculando saldos…" />}
      <ErrorMessage error={error} />
      {data && (
        <>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {data.netByMember.map((b) => (
              <li key={b.uid} className="flex items-center justify-between p-3">
                <span>{name(b.uid)}</span>
                <span
                  className={
                    b.netMinor > 0 ? 'font-semibold text-emerald-700' : b.netMinor < 0 ? 'font-semibold text-red-700' : 'text-slate-600'
                  }
                >
                  {b.netMinor > 0 ? 'le deben ' : b.netMinor < 0 ? 'debe ' : ''}
                  {formatMoney(Math.abs(b.netMinor), data.currency)}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-semibold text-slate-700">
            {view === 'simplified' ? 'Transferencias propuestas' : 'Deudas entre participantes'}
          </h3>
          {data.transfers.length === 0 ? (
            <p className="text-sm text-slate-600">No hay deudas pendientes.</p>
          ) : (
            <ul className="space-y-1">
              {data.transfers.map((t) => (
                <li key={`${t.fromUid}>${t.toUid}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {name(t.fromUid)} → {name(t.toUid)}: <strong>{formatMoney(t.amountMinor, data.currency)}</strong>
                  </span>
                  {t.fromUid === user.uid && trip.status === 'active' && (
                    <RequiresOnline label="Pagar" className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600">
                    <Link
                      to={`/trips/${trip.id}/settlements/new?to=${t.toUid}&amount=${t.amountMinor}`}
                      aria-label={`Pagar ${formatMoney(t.amountMinor, data.currency)} a ${name(t.toUid)}`}
                      className="rounded-lg bg-brand-700 px-3 py-1 text-xs font-semibold text-white"
                    >
                      Pagar
                    </Link>
                    </RequiresOnline>
                  )}
                </li>
              ))}
            </ul>
          )}
          {view === 'simplified' && (
            <p className="text-xs text-slate-600">Es solo una propuesta: no registra pagos ni cambia los gastos.</p>
          )}
        </>
      )}
    </section>
  );
}
