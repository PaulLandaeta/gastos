import { CaretLeftIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

export function BackLink({ to, children, className = '' }: { to: string; children: string; className?: string }) {
  return (
    <Link
      to={to}
      className={`-ml-1 inline-flex items-center gap-1 rounded-lg py-1 pr-2 text-sm font-medium text-brand-800 hover:bg-brand-50 ${className}`.trim()}
    >
      <CaretLeftIcon size={18} weight="bold" />
      {children}
    </Link>
  );
}
