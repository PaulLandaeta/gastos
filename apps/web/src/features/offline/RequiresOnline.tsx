import type { ReactNode } from 'react';
import { useOnline } from '../../lib/useOnline';

/**
 * FR-007: actions that need the server (pay, scan, attach, edit, export…). Offline, the action is
 * replaced by a disabled control that says why; open forms keep what was typed.
 */
export function RequiresOnline({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const online = useOnline();
  if (online) return <>{children}</>;
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={className ?? 'cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600'}
    >
      {label} <span className="text-xs">· Necesita conexión</span>
    </button>
  );
}
