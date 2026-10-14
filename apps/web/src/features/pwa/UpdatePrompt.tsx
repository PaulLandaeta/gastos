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
          <span aria-hidden>✨ </span>Hay una versión nueva de la app.
        </span>
        <span className="flex gap-2">
          <button type="button" onClick={() => setNeedRefresh(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1">
            Más tarde
          </button>
          <button type="button" onClick={() => void updateServiceWorker(true)} className="rounded-lg bg-brand-700 px-3 py-1 font-medium text-white">
            Actualizar
          </button>
        </span>
      </div>
    </div>
  );
}
