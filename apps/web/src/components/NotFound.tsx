import { Link } from 'react-router';

/** Never says whether the item exists: missing and forbidden look the same (RF-38). */
export function NotFound({ message = 'La página no existe o no tienes acceso.' }: { message?: string }) {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold">No encontrado</h1>
      <p className="text-slate-600">{message}</p>
      <Link to="/" className="text-brand-700 underline">
        Volver a mis viajes
      </Link>
    </section>
  );
}
