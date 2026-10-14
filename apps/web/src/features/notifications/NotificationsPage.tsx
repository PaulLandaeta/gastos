import { useNavigate } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Spinner } from '../../components/Spinner';
import { useOnline } from '../../lib/useOnline';
import { useMarkNotifications, useNotifications, type InboxItem } from './useNotifications';

const when = (d: Date) => d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** `/notifications`: in-app inbox, most recent first (RF-18, FR-012). No push or e-mail. */
export function NotificationsPage() {
  const { items, unread, loading } = useNotifications();
  const mark = useMarkNotifications();
  const online = useOnline();
  const navigate = useNavigate();
  if (loading || !items) return <Spinner />;

  const open = (n: InboxItem) => {
    if (!n.readAt && online) mark.mutate({ read: true, target: { ids: [n.id] } });
    navigate(n.link);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notificaciones</h1>
        <button
          type="button"
          disabled={unread === 0 || !online || mark.isPending}
          onClick={() => mark.mutate({ read: true, target: { all: true } })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Marcar todas como leídas
        </button>
      </div>
      <ErrorMessage error={mark.error} />
      {items.length === 0 ? (
        <p className="text-slate-600">No tienes notificaciones.</p>
      ) : (
        <ul className="space-y-2" aria-label="Notificaciones">
          {items.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-2 rounded-xl border p-3 ${n.readAt ? 'border-slate-200' : 'border-brand-700 bg-brand-50'}`}
            >
              <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                <span className="block font-medium">
                  {!n.readAt && <span className="sr-only">No leída: </span>}
                  {!n.readAt && (
                    <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-700 align-middle" />
                  )}
                  {n.title}
                </span>
                {n.body && <span className="block text-sm text-slate-700">{n.body}</span>}
                <span className="block text-xs text-slate-600">
                  {n.tripName} · {when(n.createdAt)}
                </span>
              </button>
              <button
                type="button"
                disabled={!online || mark.isPending}
                onClick={() => mark.mutate({ read: !n.readAt, target: { ids: [n.id] } })}
                className="shrink-0 text-xs text-brand-800 underline disabled:opacity-50"
              >
                {n.readAt ? 'Marcar como no leída' : 'Marcar como leída'}
                <span className="sr-only">: {n.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
