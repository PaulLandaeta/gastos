import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useRef, useState, type Ref } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';
import { es } from 'react-day-picker/locale';
import { Button } from './Button';
import { Sheet } from './Sheet';

/** Dates travel through the app as `YYYY-MM-DD` strings; the calendar works on local dates. */
export function isoToDate(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

export function dateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const LONG = new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const formatLong = (iso: string, short = false) => {
  const d = isoToDate(iso);
  return d ? (short ? SHORT : LONG).format(d) : '';
};

const day =
  'flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-slate-800 transition-colors hover:bg-brand-50 disabled:pointer-events-none';

/** Tailwind-styled month grid shared by every date field (react-day-picker, Spanish, Monday first). */
function Calendar(props: {
  selected?: Date | undefined;
  range?: { from?: Date | undefined; to?: Date | undefined };
  disabled?: Matcher | Matcher[];
  onDay: (d: Date) => void;
}) {
  const { selected, range, disabled, onDay } = props;
  const anchor = selected ?? range?.from ?? range?.to ?? new Date();
  const [month, setMonth] = useState(anchor);
  const modifiers: Record<string, Matcher | Matcher[] | undefined> = {};
  if (range?.from) modifiers['range_start'] = range.from;
  if (range?.to) modifiers['range_end'] = range.to;
  if (range?.from && range.to) modifiers['range_middle'] = { after: range.from, before: range.to };
  const marked = [selected, range?.from, range?.to].filter((d): d is Date => !!d);

  return (
    <DayPicker
      locale={es}
      month={month}
      onMonthChange={setMonth}
      showOutsideDays
      fixedWeeks
      autoFocus
      disabled={disabled}
      modifiers={{ ...modifiers, picked: marked }}
      onDayClick={(d, m) => !m.disabled && onDay(d)}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? <CaretLeftIcon size={18} weight="bold" /> : <CaretRightIcon size={18} weight="bold" />,
      }}
      classNames={{
        root: 'relative',
        months: 'flex justify-center',
        month: 'space-y-2',
        month_caption: 'flex h-10 items-center justify-center',
        caption_label: 'text-base font-semibold capitalize',
        nav: 'absolute inset-x-0 top-0 flex h-10 items-center justify-between',
        button_previous: 'flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 aria-disabled:opacity-30',
        button_next: 'flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 aria-disabled:opacity-30',
        month_grid: 'border-collapse',
        weekdays: '',
        weekday: 'h-8 w-10 text-xs font-semibold uppercase text-slate-500',
        week: '',
        day: 'p-0 text-center',
        day_button: day,
        today: '[&>button]:ring-1 [&>button]:ring-brand-600 [&>button]:text-brand-800',
        outside: '[&>button]:text-slate-500',
        disabled: '[&>button]:text-slate-300',
        hidden: 'invisible',
      }}
      modifiersClassNames={{
        picked: '[&>button]:!bg-brand-700 [&>button]:!text-white [&>button]:ring-0',
        range_middle: 'bg-brand-50 [&>button]:rounded-none [&>button]:text-brand-900',
        range_start: 'rounded-l-full bg-brand-50',
        range_end: 'rounded-r-full bg-brand-50',
      }}
    />
  );
}

const trigger =
  'flex w-full items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-left text-base shadow-sm hover:border-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 aria-[invalid=true]:border-red-600';

function TriggerContent({ value, placeholder, short = false }: { value: string; placeholder: string; short?: boolean }) {
  return (
    <>
      <CalendarBlankIcon className="shrink-0 text-brand-700" />
      <span className={`truncate ${value ? 'text-slate-900' : 'text-slate-500'}`}>{value ? formatLong(value, short) : placeholder}</span>
    </>
  );
}

/**
 * One date. The trigger is a button (labelled by the surrounding <Field>'s <label for=id>) that
 * opens the calendar in a bottom sheet; picking a day closes it.
 */
export function DateInput({
  id,
  value,
  onChange,
  title,
  invalid,
  describedBy,
  min,
  max,
  placeholder = 'Elegir fecha',
  allowClear = false,
  buttonRef,
}: {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  /** Sheet heading, usually the field label. */
  title: string;
  invalid?: boolean;
  describedBy?: string | undefined;
  min?: string;
  max?: string;
  placeholder?: string;
  allowClear?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const [open, setOpen] = useState(false);
  const own = useRef<HTMLButtonElement | null>(null);
  const close = () => {
    setOpen(false);
    own.current?.focus();
  };
  const disabled: Matcher[] = [];
  const minD = min ? isoToDate(min) : undefined;
  const maxD = max ? isoToDate(max) : undefined;
  if (minD) disabled.push({ before: minD });
  if (maxD) disabled.push({ after: maxD });
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
        aria-describedby={describedBy}
        onClick={() => setOpen(true)}
        className={trigger}
      >
        <TriggerContent value={value} placeholder={placeholder} />
      </button>
      <Sheet
        open={open}
        title={title}
        onClose={close}
        footer={
          allowClear && value ? (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                onChange('');
                close();
              }}
            >
              Quitar fecha
            </Button>
          ) : undefined
        }
      >
        <Calendar
          selected={isoToDate(value)}
          disabled={disabled}
          onDay={(d) => {
            onChange(dateToIso(d));
            close();
          }}
        />
      </Sheet>
    </>
  );
}

/**
 * A start/end pair (trip dates, multi-day service) edited in one range calendar: pick the start,
 * then the end; days before the start are disabled while choosing the end.
 */
export function DateRangeInputs({
  start,
  end,
  value,
  onChange,
}: {
  start: { id: string; label: string; error?: string | undefined; ref?: Ref<HTMLButtonElement> };
  end: { id: string; label: string; error?: string | undefined; ref?: Ref<HTMLButtonElement> };
  value: { start: string; end: string };
  onChange: (v: { start: string; end: string }) => void;
}) {
  const [editing, setEditing] = useState<'start' | 'end' | null>(null);
  const refs = { start: useRef<HTMLButtonElement | null>(null), end: useRef<HTMLButtonElement | null>(null) };
  const from = isoToDate(value.start);
  const to = isoToDate(value.end);
  const close = () => {
    const which = editing;
    setEditing(null);
    if (which) refs[which].current?.focus();
  };
  const pick = (d: Date) => {
    const iso = dateToIso(d);
    if (editing === 'start') {
      onChange({ start: iso, end: value.end && value.end >= iso ? value.end : '' });
      setEditing('end');
    } else {
      onChange({ start: value.start || iso, end: iso });
      close();
    }
  };

  const field = (which: 'start' | 'end') => {
    const f = which === 'start' ? start : end;
    return (
      <div className="space-y-1">
        <label htmlFor={f.id} className="block text-sm font-medium text-slate-800">
          {f.label}
        </label>
        <button
          id={f.id}
          ref={(el) => {
            refs[which].current = el;
            if (typeof f.ref === 'function') f.ref(el);
            else if (f.ref) f.ref.current = el;
          }}
          type="button"
          aria-haspopup="dialog"
          aria-invalid={!!f.error || undefined}
          aria-describedby={f.error ? `${f.id}-error` : undefined}
          onClick={() => setEditing(which)}
          className={trigger}
        >
          <TriggerContent value={which === 'start' ? value.start : value.end} placeholder="Elegir" short />
        </button>
        {f.error && (
          <p id={`${f.id}-error`} role="alert" className="text-xs font-medium text-red-700">
            {f.error}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {field('start')}
        {field('end')}
      </div>
      <Sheet
        open={editing !== null}
        title={editing === 'end' ? end.label : start.label}
        subtitle={editing === 'end' ? 'Ahora elige el último día.' : 'Elige el primer día.'}
        onClose={close}
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-700">
              {value.start ? `${formatLong(value.start, true)} – ${value.end ? formatLong(value.end, true) : '…'}` : ''}
            </p>
            <Button onClick={close}>Listo</Button>
          </div>
        }
      >
        <Calendar
          key={editing ?? 'closed'}
          range={{ from, to }}
          {...(editing === 'end' && from ? { disabled: { before: from } } : {})}
          onDay={pick}
        />
      </Sheet>
    </>
  );
}
