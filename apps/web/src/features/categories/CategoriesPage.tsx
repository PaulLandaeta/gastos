import { CategoryIcon } from '../../lib/categoryIcon';
import { BackLink } from '../../components/ui/BackLink';
import { buttonClass } from '../../components/ui/Button';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Field, inputClass } from '../../components/Field';
import { NotFound } from '../../components/NotFound';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/apiClient';
import { useCurrentUser } from '../auth/AuthProvider';
import { useCategories } from '../expenses/useExpenses';
import { useTrip } from '../trips/useTrip';

/** FR-014/FR-015: trip categories; only creator/admin manage them. */
export function CategoriesPage() {
  const { tripId = '' } = useParams();
  const { user } = useCurrentUser();
  const { trip, members, loading } = useTrip(tripId);
  const { all, loading: catLoading } = useCategories(tripId);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#0d9488');
  const create = useMutation({
    mutationFn: () => api('POST', `/trips/${tripId}/categories`, { body: { name, color } }),
    onSuccess: () => setName(''),
  });
  const toggle = useMutation({
    mutationFn: (c: { id: string; version: number; active: boolean }) =>
      api('PATCH', `/trips/${tripId}/categories/${c.id}`, { body: { expectedVersion: c.version, active: !c.active } }),
  });

  if (loading || trip === undefined || catLoading) return <Spinner />;
  const me = members.find((m) => m.uid === user.uid);
  if (trip === null || !me) return <NotFound />;
  const manager = (me.role === 'creator' || me.role === 'admin') && (trip.status === 'active' || trip.status === 'pending');

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate();
  }

  return (
    <div className="space-y-5">
      <BackLink to={`/trips/${tripId}?tab=resumen`}>Volver al viaje</BackLink>
      <h1 className="text-2xl font-bold tracking-tight">Categorías</h1>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200/70 bg-surface shadow-card">
        {all.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 p-3">
            <span className="flex items-center gap-2">
              <span className={c.active ? '' : 'opacity-50 grayscale'}>
                <CategoryIcon category={c} size="sm" />
              </span>
              <span className={c.active ? '' : 'text-slate-500'}>{c.name}</span>
              {!c.active && <span className="rounded bg-slate-200 px-1.5 text-xs">Inactiva</span>}
              {c.isDefault && <span className="text-xs text-slate-500">inicial</span>}
            </span>
            {manager && (
              <button
                type="button"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: c.id, version: c.version, active: c.active })}
                className={buttonClass('secondary', 'sm')}
                aria-label={`${c.active ? 'Desactivar' : 'Activar'} ${c.name}`}
              >
                {c.active ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorMessage error={toggle.error} />
      {manager && (
        <form onSubmit={onCreate} className="space-y-3 rounded-2xl border border-slate-200/70 bg-surface shadow-card p-4">
          <h2 className="font-semibold">Nueva categoría</h2>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <Field id="cat-name" label="Nombre de la categoría">
              <input id="cat-name" maxLength={40} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="cat-color" label="Color">
              <input id="cat-color" type="color" className="h-11 w-full rounded-xl border border-slate-300 bg-white p-1" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          </div>
          <ErrorMessage error={create.error} />
          <button type="submit" disabled={create.isPending} className={buttonClass('primary', 'md')}>
            Crear categoría
          </button>
        </form>
      )}
    </div>
  );
}
