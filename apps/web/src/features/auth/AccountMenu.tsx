import { useEffect, useRef, useState } from 'react';
import { InstallButton } from '../pwa/InstallButton';
import { pendingCounts, usePending } from '../offline/usePending';
import { useAuth, useCurrentUser } from './AuthProvider';

export function AccountMenu() {
  const { signOut } = useAuth();
  const { user, profile } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const { pending } = usePending();
  const { waiting, attention } = pendingCounts(pending);
  const unsent = waiting + attention;
  const ref = useRef<HTMLDivElement>(null);
  const name = profile?.displayName ?? user.displayName ?? user.email ?? 'Usuario';
  const email = profile?.email ?? user.email ?? '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Cuenta de ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-brand-700 font-semibold text-white"
      >
        {user.photoURL ? <img src={user.photoURL} alt="" className="h-full w-full object-cover" /> : name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="px-3 py-2">
            <p className="font-medium">{name}</p>
            <p className="truncate text-sm text-slate-600">{email}</p>
          </div>
          <InstallButton />
          <button
            type="button"
            role="menuitem"
            onClick={() => (unsent > 0 ? setConfirmSignOut(true) : void signOut())}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
          >
            Cerrar sesión
          </button>
          {confirmSignOut && (
            <div role="alertdialog" aria-labelledby="signout-warning" className="mt-2 space-y-2 rounded-lg bg-amber-50 p-3 text-sm">
              <p id="signout-warning" className="text-amber-950">
                Tienes {unsent} {unsent === 1 ? 'gasto sin enviar' : 'gastos sin enviar'}. Si cierras sesión se borrarán de este
                dispositivo.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirmSignOut(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">
                  Cancelar
                </button>
                <button type="button" onClick={() => void signOut()} className="rounded-lg bg-red-700 px-3 py-1.5 font-medium text-white">
                  Borrar y cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
