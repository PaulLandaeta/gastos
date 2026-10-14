import { useEffect, useRef, useState } from 'react';
import { useAuth, useCurrentUser } from './AuthProvider';

export function AccountMenu() {
  const { signOut } = useAuth();
  const { user, profile } = useCurrentUser();
  const [open, setOpen] = useState(false);
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
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
