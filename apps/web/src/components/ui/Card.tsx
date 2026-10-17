import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export const cardClass = 'rounded-2xl border border-slate-200/70 bg-surface shadow-card';

export function Card({ className = '', ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={`${cardClass} ${className}`.trim()} {...rest} />;
}

/** A titled block of a page (h2 + optional action on the right). */
export function Section({
  title,
  id,
  action,
  children,
  className = '',
}: {
  title: string;
  id?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`space-y-3 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
