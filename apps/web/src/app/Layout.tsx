import { AirplaneTiltIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link, Outlet } from 'react-router';
import { StatusBar } from '../features/offline/StatusBar';

export function Layout({ actions }: { actions?: ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-brand-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-700 text-white">
              <AirplaneTiltIcon size={18} weight="fill" />
            </span>
            Gastos de Viaje
          </Link>
          {actions}
        </div>
        <StatusBar />
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
