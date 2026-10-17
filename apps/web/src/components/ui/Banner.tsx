import { CheckCircleIcon, InfoIcon, WarningIcon, WifiSlashIcon } from '@phosphor-icons/react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

type Tone = 'info' | 'warning' | 'success' | 'danger' | 'offline';

const TONE: Record<Tone, { cls: string; icon: ReactNode }> = {
  info: { cls: 'bg-sky-50 text-sky-900', icon: <InfoIcon weight="fill" className="text-sky-600" /> },
  warning: { cls: 'bg-amber-50 text-amber-900', icon: <WarningIcon weight="fill" className="text-amber-600" /> },
  success: { cls: 'bg-emerald-50 text-emerald-900', icon: <CheckCircleIcon weight="fill" className="text-emerald-600" /> },
  danger: { cls: 'bg-rose-50 text-rose-900', icon: <WarningIcon weight="fill" className="text-rose-600" /> },
  offline: { cls: 'bg-slate-100 text-slate-800', icon: <WifiSlashIcon weight="bold" className="text-slate-600" /> },
};

/** Inline notice with a leading icon; the role (status/alert) is up to the caller. */
export function Banner({
  tone = 'info',
  icon,
  children,
  className = '',
  ...rest
}: { tone?: Tone; icon?: ReactNode } & ComponentPropsWithoutRef<'div'>) {
  const t = TONE[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-sm ${t.cls} ${className}`.trim()} {...rest}>
      <span className="mt-px shrink-0">{icon ?? t.icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
