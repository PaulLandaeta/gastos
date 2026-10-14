import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/apiClient';

interface Expiring {
  id: string;
  fileName: string;
  expiresAt: string;
  target: { expenseId: string } | { settlementId: string };
  label: string;
}

const formatExpiry = (iso: string) => new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

/** FR-022: receipts expiring within 14 days, only for those who can see them (filtered by the API). */
export function ExpiringNotice({ tripId }: { tripId: string }) {
  const q = useQuery({
    queryKey: ['expiring', tripId],
    queryFn: () => api<{ attachments: Expiring[] }>('GET', `/trips/${tripId}/attachments/expiring`),
    staleTime: 5 * 60_000,
  });
  const items = q.data?.attachments ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label="Comprobantes por vencer" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <h2 className="font-semibold">⚠️ Comprobantes por vencer</h2>
      <p>Por la política de retención (6 meses) se eliminarán pronto. Descárgalos si los necesitas.</p>
      <ul className="space-y-1">
        {items.map((a) => (
          <li key={a.id}>
            {'expenseId' in a.target ? (
              <Link to={`/trips/${tripId}/expenses/${a.target.expenseId}`} className="underline">
                {a.label}
              </Link>
            ) : (
              a.label
            )}
            : {a.fileName} · se elimina el {formatExpiry(a.expiresAt)}
          </li>
        ))}
      </ul>
    </section>
  );
}
