import { buttonClass } from '../../components/ui/Button';
import { SparkleIcon } from '@phosphor-icons/react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * US2 scenario 2: a new version is announced and applied only when the user accepts. Pending
 * expenses live in IndexedDB, which an update never touches.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="border-b border-slate-200 bg-brand-50 px-4 py-2 text-sm text-brand-800">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2">
        <span>
          <SparkleIcon weight="fill" className="mr-1.5 inline align-[-4px] text-brand-600" />Hay una versión nueva de la app.
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={() => setNeedRefresh(false)} className={buttonClass('secondary', 'sm')}>
            Más tarde
          </button>
          <button type="button" onClick={() => void updateServiceWorker(true)} className={buttonClass('primary', 'sm')}>
            Actualizar
          </button>
        </span>
      </div>
    </div>
  );
}
