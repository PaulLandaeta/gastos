import { createBrowserRouter } from 'react-router';
import { NotFound } from '../components/NotFound';
import { AccountMenu } from '../features/auth/AccountMenu';
import { CategoriesPage } from '../features/categories/CategoriesPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { EditExpensePage } from '../features/expenses/EditExpensePage';
import { ExpenseDetailPage } from '../features/expenses/ExpenseDetailPage';
import { ExpenseListPage } from '../features/expenses/ExpenseListPage';
import { NewExpensePage } from '../features/expenses/NewExpensePage';
import { PendingEditPage } from '../features/offline/PendingEditPage';
import { PendingPage } from '../features/offline/PendingPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { Bell } from '../features/notifications/Bell';
import { ScanPage } from '../features/scan/ScanPage';
import { PaySettlementPage } from '../features/settlements/PaySettlementPage';
import { CreateTripPage } from '../features/trips/CreateTripPage';
import { TripDetailPage } from '../features/trips/TripDetailPage';
import { TripsListPage } from '../features/trips/TripsListPage';
import { Layout } from './Layout';

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
          { path: '/trips/new', element: <CreateTripPage /> },
          { path: '/trips/:tripId', element: <TripDetailPage /> },
          { path: '/trips/:tripId/expenses', element: <ExpenseListPage /> },
          { path: '/trips/:tripId/categories', element: <CategoriesPage /> },
          { path: '/trips/:tripId/settlements/new', element: <PaySettlementPage /> },
          { path: '/trips/:tripId/expenses/new', element: <NewExpensePage /> },
          { path: '/trips/:tripId/scan', element: <ScanPage /> },
          { path: '/trips/:tripId/expenses/:expenseId', element: <ExpenseDetailPage /> },
          { path: '/trips/:tripId/expenses/:expenseId/edit', element: <EditExpensePage /> },
          { path: '/pending', element: <PendingPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/pending/:localId/edit', element: <PendingEditPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
