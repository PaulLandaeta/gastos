export interface MemberOption {
  uid: string;
  name: string;
}

/** Toggle chips to pick beneficiaries (multi) or one person (single). */
export function MemberChips({
  label,
  options,
  selected,
  onChange,
  single,
}: {
  label: string;
  options: MemberOption[];
  selected: string[];
  onChange: (uids: string[]) => void;
  single?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-800">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.uid);
          return (
            <button
              key={o.uid}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(single ? [o.uid] : on ? selected.filter((u) => u !== o.uid) : [...selected, o.uid])
              }
              className="rounded-full border px-3 py-1.5 text-sm aria-pressed:border-brand-700 aria-pressed:bg-brand-700 aria-pressed:text-white border-slate-300"
            >
              {o.name}
            </button>
          );
        })}
        {!single && options.length > 2 && (
          <button
            type="button"
            onClick={() => onChange(selected.length === options.length ? [] : options.map((o) => o.uid))}
            className="rounded-full px-3 py-1.5 text-sm text-brand-800 underline"
          >
            {selected.length === options.length ? 'Ninguno' : 'Todos'}
          </button>
        )}
      </div>
    </fieldset>
  );
}
