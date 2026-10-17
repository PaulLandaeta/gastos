import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-surface/60 px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</span>
      <p className="font-semibold text-slate-800">{title}</p>
      {children && <div className="text-sm text-slate-600">{children}</div>}
    </div>
  );
}
