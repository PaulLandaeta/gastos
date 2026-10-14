import { Link } from 'react-router';
import { lastOnlineAt, useOnline } from '../../lib/useOnline';
import { pendingCounts, usePending } from './usePending';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** FR-006: permanent offline indicator plus pending / needs-attention counters. */
export function StatusBar() {
  const online = useOnline();
  const { pending } = usePending();
  const { waiting, attention } = pendingCounts(pending);
  if (online && waiting === 0 && attention === 0) return null;
  const since = lastOnlineAt();

  return (
    <div
      role="status"
      className={`border-b px-4 py-2 text-sm ${online ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-amber-300 bg-amber-50 text-amber-950'}`}
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
        {!online && (
          <span className="font-medium">
            <span aria-hidden>📴 </span>Sin conexión
            {since && (
              <span className="font-normal">
                {' '}
                · datos del{' '}
                {since.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </span>
        )}
        {waiting > 0 && (
          <Link to="/pending" className="underline">
            <span aria-hidden>⏳ </span>
            {plural(waiting, 'pendiente', 'pendientes')}
          </Link>
        )}
        {attention > 0 && (
          <Link to="/pending" className="font-semibold text-red-800 underline">
            <span aria-hidden>⚠️ </span>
            {plural(attention, 'requiere atención', 'requieren atención')}
          </Link>
        )}
      </div>
    </div>
  );
}
