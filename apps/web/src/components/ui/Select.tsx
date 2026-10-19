import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useRef, useState, type Ref } from 'react';
import { Sheet } from './Sheet';

export type SelectOption = { value: string; label: string; group?: string };

const trigger =
  'flex w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-base shadow-sm hover:border-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 aria-[invalid=true]:border-red-600';

/** Long lists (currencies) get a filter box at the top of the sheet. */
const SEARCH_FROM = 12;

/**
 * Replaces the native <select>: the trigger is a button (labelled by its <label for=id>) and the
 * options open in the same bottom sheet as the calendar, so the list never pops up detached from
 * the field and looks the same on every browser.
 */
export function Select({
  id,
  value,
  onChange,
  options,
  title,
  invalid,
  describedBy,
  buttonRef,
  className = trigger,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Sheet heading, usually the field label. */
  title: string;
  invalid?: boolean;
  describedBy?: string | undefined;
  buttonRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const own = useRef<HTMLButtonElement | null>(null);
  const current = options.find((o) => o.value === value);
  const close = () => {
    setOpen(false);
    setQuery('');
    own.current?.focus();
  };
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const groups: { name: string | undefined; items: SelectOption[] }[] = [];
  for (const o of shown) {
    const last = groups[groups.length - 1];
    if (last && last.name === o.group) last.items.push(o);
    else groups.push({ name: o.group, items: [o] });
  }

  return (
    <>
      <button
        id={id}
        ref={(el) => {
          own.current = el;
          if (typeof buttonRef === 'function') buttonRef(el);
          else if (buttonRef) buttonRef.current = el;
        }}
        type="button"
        aria-haspopup="dialog"
        aria-invalid={invalid || undefined}
        aria-describedby={[`${id}-value`, describedBy].filter(Boolean).join(' ')}
        onClick={() => setOpen(true)}
        className={className}
      >
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate text-slate-900">
          {current?.label ?? ''}
        </span>
        <CaretDownIcon size={16} weight="bold" className="shrink-0 text-slate-500" />
      </button>
      <Sheet open={open} title={title} onClose={close}>
        {options.length >= SEARCH_FROM && (
          <label className="relative mb-2 block">
            <span className="sr-only">Buscar</span>
            <MagnifyingGlassIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              className="block w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
        )}
        <div role="radiogroup" aria-label={title} className="-mx-1 max-h-[55dvh] overflow-y-auto px-1 pb-1">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.name && <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-600">{g.name}</p>}
              {g.items.map((o) => {
                const checked = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    autoFocus={checked && !q}
                    onClick={() => {
                      onChange(o.value);
                      close();
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-base ${
                      checked ? 'bg-brand-50 font-semibold text-brand-900' : 'text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <span className="truncate">{o.label}</span>
                    {checked && <CheckIcon size={18} weight="bold" className="shrink-0 text-brand-700" />}
                  </button>
                );
              })}
            </div>
          ))}
          {shown.length === 0 && <p className="px-3 py-4 text-sm text-slate-600">Sin resultados</p>}
        </div>
      </Sheet>
    </>
  );
}
