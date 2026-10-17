import { DownloadSimpleIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The event fires once, possibly before the menu is mounted: keep it at module level. */
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIosSafari = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

/**
 * US2 / RF-49: «Instalar app» where the browser supports it (Android, desktop); on iOS Safari a
 * short guide, because installation there is manual («Añadir a pantalla de inicio»).
 */
export function InstallButton() {
  const [, rerender] = useState(0);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (isStandalone()) return null;
  if (deferred) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          const e = deferred;
          deferred = null;
          void e?.prompt();
        }}
        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
      >
        <DownloadSimpleIcon className="mr-2 inline align-[-4px]" />Instalar app
      </button>
    );
  }
  if (!isIosSafari()) return null;
  return (
    <div>
      <button
        type="button"
        role="menuitem"
        aria-expanded={guide}
        onClick={() => setGuide((g) => !g)}
        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
      >
        <DownloadSimpleIcon className="mr-2 inline align-[-4px]" />Instalar app
      </button>
      {guide && (
        <p className="px-3 pb-2 text-sm text-slate-700">
          En Safari, toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>. iOS puede borrar los
          datos guardados sin conexión si no abres la app durante varias semanas.
        </p>
      )}
    </div>
  );
}
