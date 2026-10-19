import { XIcon } from '@phosphor-icons/react';
import { useEffect, useId, type ReactNode } from 'react';

/**
 * Bottom sheet on phones, centered dialog from `sm` up. Escape and the backdrop close it; the
 * opener is responsible for moving focus back to its trigger.
 */
export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-md rounded-t-3xl bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-2xl sm:rounded-3xl sm:pb-4"
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-start justify-between gap-3 px-1 pb-2">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-2 text-slate-600 hover:bg-slate-100">
            <XIcon size={20} />
          </button>
        </div>
        {children}
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  );
}
