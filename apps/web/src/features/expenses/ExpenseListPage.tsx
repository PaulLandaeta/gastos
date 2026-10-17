import { Navigate, useParams } from 'react-router';

/** The list now lives in the trip's «Gastos» tab; old links and notifications land there. */
export function ExpenseListPage() {
  const { tripId = '' } = useParams();
  return <Navigate to={`/trips/${tripId}?tab=gastos`} replace />;
}
