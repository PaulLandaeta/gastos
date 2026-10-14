import type { TripStatus } from 'contracts';

export const STATUS_LABEL: Record<TripStatus, string> = {
  pending: 'Pendiente',
  active: 'Activo',
  closed: 'Cerrado',
  archived: 'Archivado',
};

const STATUS_CLASS: Record<TripStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  active: 'bg-emerald-100 text-emerald-900',
  closed: 'bg-slate-200 text-slate-800',
  archived: 'bg-slate-100 text-slate-600',
};

export function StatusBadge({ status }: { status: TripStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
