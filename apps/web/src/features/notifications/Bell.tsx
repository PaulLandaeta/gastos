import { BellIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { unreadLabel, useNotifications } from './useNotifications';

/** Header bell with the unread counter (FR-012). */
export function Bell() {
  const { unread } = useNotifications();
  const label = unread === 0 ? 'Notificaciones' : `${unreadLabel(unread)} notificaciones sin leer`;
  return (
    <Link to="/notifications" aria-label={label} className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100">
      <BellIcon size={24} className="text-slate-700" />
      {unread > 0 && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-700 px-1 text-center text-xs font-semibold leading-5 text-white">
          {unreadLabel(unread)}
        </span>
      )}
    </Link>
  );
}
