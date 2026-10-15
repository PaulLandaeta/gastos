import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { NotFound } from '../components/NotFound';
import { AccountMenu } from '../features/auth/AccountMenu';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { Bell } from '../features/notifications/Bell';
import { TripsListPage } from '../features/trips/TripsListPage';
import { Layout } from './Layout';

const loaders: (() => Promise<unknown>)[] = [];

/**
 * Route-level code splitting: the sign-in and trip list paint first and every other screen loads in
 * the background right after (`prefetchRoutes`), so they still open offline even before the service
 * worker controls the page (feature 005, RF-17).
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  loaders.push(load);
  return async () => ({ Component: (await load())[name] });
}

export function prefetchRoutes(): void {
  for (const load of loaders) void load().catch(() => undefined);
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: (
          <Layout
            actions={
              <div className="flex items-center gap-2">
                <Bell />
                <AccountMenu />
              </div>
            }
          />
        ),
        children: [
          { path: '/', element: <TripsListPage /> },
          { path: '/trips/new', lazy: page(() => import('../features/trips/CreateTripPage'), 'CreateTripPage') },
          { path: '/trips/:tripId', lazy: page(() => import('../features/trips/TripDetailPage'), 'TripDetailPage') },
          { path: '/trips/:tripId/expenses', lazy: page(() => import('../features/expenses/ExpenseListPage'), 'ExpenseListPage') },
          { path: '/trips/:tripId/categories', lazy: page(() => import('../features/categories/CategoriesPage'), 'CategoriesPage') },
          { path: '/trips/:tripId/settlements/new', lazy: page(() => import('../features/settlements/PaySettlementPage'), 'PaySettlementPage') },
          { path: '/trips/:tripId/expenses/new', lazy: page(() => import('../features/expenses/NewExpensePage'), 'NewExpensePage') },
          { path: '/trips/:tripId/scan', lazy: page(() => import('../features/scan/ScanPage'), 'ScanPage') },
          { path: '/trips/:tripId/expenses/:expenseId', lazy: page(() => import('../features/expenses/ExpenseDetailPage'), 'ExpenseDetailPage') },
          { path: '/trips/:tripId/expenses/:expenseId/edit', lazy: page(() => import('../features/expenses/EditExpensePage'), 'EditExpensePage') },
          { path: '/pending', lazy: page(() => import('../features/offline/PendingPage'), 'PendingPage') },
          { path: '/notifications', lazy: page(() => import('../features/notifications/NotificationsPage'), 'NotificationsPage') },
          { path: '/pending/:localId/edit', lazy: page(() => import('../features/offline/PendingEditPage'), 'PendingEditPage') },
          { path: '/account/delete', lazy: page(() => import('../features/account/DeleteAccountPage'), 'DeleteAccountPage') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
