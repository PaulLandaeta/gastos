import { WarningIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export function Field({
  id,
  label,
  error,
  hint,
  warn = false,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  /** The hint is a warning (e.g. a value read by the scanner that needs review). */
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className={`flex items-center gap-1 text-xs ${warn ? 'text-amber-900' : 'text-slate-600'}`}>
          {warn && <WarningIcon weight="fill" size={14} className="shrink-0 text-amber-600" />}
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 aria-[invalid=true]:border-red-600';
