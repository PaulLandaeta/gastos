import { Link } from 'react-router';

export function NotFound() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">No encontrado</h1>
      <p className="text-slate-600">La página no existe o no tienes acceso.</p>
      <Link to="/" className="text-brand-700 underline">
        Volver a mis viajes
      </Link>
    </section>
  );
}
