import { AirplaneTiltIcon, ReceiptIcon, ScalesIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { state, signIn } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const deleted = new URLSearchParams(location.search).get('deleted') === '1';

  // The page paints at once (fast LCP); the button waits until Firebase Auth has restored the session.
  const loading = state.status === 'loading';
  if (state.status === 'signedIn') return <Navigate to={from} replace />;

  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-700 to-brand-900 px-6 pb-16 pt-[calc(4rem+env(safe-area-inset-top))] text-white">
        <AirplaneTiltIcon aria-hidden size={220} weight="duotone" className="pointer-events-none absolute -right-14 -top-6 text-white/10" />
        <div className="relative mx-auto max-w-sm space-y-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-fab">
            <AirplaneTiltIcon size={32} weight="fill" />
          </span>
          <h1 className="text-4xl font-bold tracking-tight">Gastos de Viaje</h1>
          <p className="text-lg text-brand-50">Registra y reparte los gastos de tus viajes con exactitud al centavo.</p>
        </div>
      </div>
      <div className="mx-auto -mt-8 w-full max-w-sm flex-1 space-y-6 px-4 pb-10">
        <ul className="relative z-10 grid grid-cols-3 gap-2 rounded-3xl bg-surface p-4 text-center text-xs font-medium text-slate-700 shadow-card">
          <li className="flex flex-col items-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <ReceiptIcon size={22} weight="duotone" />
            </span>
            Escanea facturas
          </li>
          <li className="flex flex-col items-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <UsersThreeIcon size={22} weight="duotone" />
            </span>
            Reparte en grupo
          </li>
          <li className="flex flex-col items-center gap-1.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <ScalesIcon size={22} weight="duotone" />
            </span>
            Saldos claros
          </li>
        </ul>
      {deleted && (
        <p role="status" className="rounded-xl bg-slate-100 px-3 py-2 text-center text-sm text-slate-800">
          Tu cuenta se eliminó. Si vuelves a entrar con Google empezarás como una cuenta nueva.
        </p>
      )}
      <button
        type="button"
        disabled={loading}
        aria-busy={loading}
        onClick={() => void signIn()}
        className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3.5 text-base font-semibold shadow-card hover:bg-slate-50 disabled:opacity-60"
      >
        <svg aria-hidden width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        Continuar con Google
      </button>
      {state.status === 'signedOut' && state.error && (
        <p role="alert" className="text-center text-sm text-red-700">
          {state.error}
        </p>
      )}
      </div>
    </main>
  );
}
