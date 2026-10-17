/** Segmented control with tab semantics (Tricount-style pill switcher). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  full = false,
  idPrefix,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  full?: boolean;
  /** When set, each tab controls `${idPrefix}-panel`. */
  idPrefix?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`${full ? 'flex' : 'inline-flex'} rounded-xl bg-slate-200/70 p-1`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          id={idPrefix ? `${idPrefix}-tab-${o.value}` : undefined}
          aria-controls={idPrefix ? `${idPrefix}-panel` : undefined}
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`${full ? 'flex-1' : ''} rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors aria-selected:bg-white aria-selected:text-slate-900 aria-selected:shadow-card`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Same look, toggle-button semantics (aria-pressed) for view switches that are not tabs. */
export function PressedGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-slate-200/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors aria-pressed:bg-white aria-pressed:text-slate-900 aria-pressed:shadow-card"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
