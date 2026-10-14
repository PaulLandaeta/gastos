import { createBrowserRouter } from 'react-router';
import { NotFound } from '../components/NotFound';
import { AccountMenu } from '../features/auth/AccountMenu';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
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
        element: <Layout actions={<AccountMenu />} />,
        children: [
          { path: '/', element: <TripsListPage /> },
          { path: '/trips/new', element: <CreateTripPage /> },
          { path: '/trips/:tripId', element: <TripDetailPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
