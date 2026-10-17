import { buttonClass } from '../../components/ui/Button';
/** RF-36: shows which fields changed under the user and lets them choose how to continue. */
export function ConflictDiff({
  fields,
  onReload,
  onKeep,
}: {
  fields: { field: string; label: string }[];
  onReload: () => void;
  onKeep: () => void;
}) {
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Otra persona modificó el gasto mientras lo editabas.</p>
      {fields.length > 0 ? (
        <>
          <p>Campos en los que tu borrador difiere de la versión actual:</p>
          <ul className="list-disc pl-5">
            {fields.map((f) => (
              <li key={f.field}>{f.label}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Tu borrador coincide con la versión actual.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onReload} className={buttonClass('secondary', 'md')}>
          Recargar con la versión actual
        </button>
        <button type="button" onClick={onKeep} className="rounded-lg bg-amber-700 px-3 py-2 font-medium text-white">
          Mantener mi borrador
        </button>
      </div>
    </div>
  );
}
