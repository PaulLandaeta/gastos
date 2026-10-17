import { parseMoneyInput } from 'contracts';
import { minorUnits } from 'finance-engine';
import { useEffect, useId, useState } from 'react';
import { inputClass } from './Field';

/** Formats minor units back to an editable decimal string (no floats). */
export function toEditable(minor: number, decimals: number, locale = 'es'): string {
  if (minor === 0) return '';
  const digits = String(Math.abs(minor)).padStart(decimals + 1, '0');
  if (decimals === 0) return digits;
  const sep = locale.startsWith('en') ? '.' : ',';
  return `${digits.slice(0, -decimals)}${sep}${digits.slice(-decimals)}`;
}

interface Props {
  id?: string;
  label: string;
  currency: string;
  valueMinor: number | null;
  onChange: (minor: number | null) => void;
  required?: boolean;
  compact?: boolean;
  describedBy?: string;
}

/**
 * Accessible money field: decimal keyboard on mobile, shows the trip currency, parses with
 * `parseMoneyInput` (integer minor units, never floats) and flags invalid input.
 */
export function MoneyInput({ id, label, currency, valueMinor, onChange, required, compact, describedBy }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const decimals = minorUnits(currency);
  const locale = navigator.language || 'es';
  const [text, setText] = useState(() => toEditable(valueMinor ?? 0, decimals, locale));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const parsed = parseMoneyInput(text, decimals, locale);
    if (parsed !== valueMinor && !(text === '' && valueMinor === null)) {
      setText(toEditable(valueMinor ?? 0, decimals, locale));
      setInvalid(false);
    }
    // only react to external value changes
  }, [valueMinor]);

  return (
    <div className={compact ? 'min-w-0' : 'space-y-1'}>
      <label htmlFor={inputId} className={compact ? 'sr-only' : 'block text-sm font-medium text-slate-800'}>
        {label}
      </label>
      <div className="flex items-center rounded-xl border border-slate-300 bg-white shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20 aria-[invalid=true]:border-red-600" aria-invalid={invalid}>
        <span className="pl-3 text-sm text-slate-600" aria-hidden>
          {currency}
        </span>
        <input
          id={inputId}
          inputMode={decimals === 0 ? 'numeric' : 'decimal'}
          autoComplete="off"
          required={required}
          aria-invalid={invalid}
          aria-describedby={[describedBy, invalid ? `${inputId}-err` : null].filter(Boolean).join(' ') || undefined}
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const parsed = next.trim() === '' ? null : parseMoneyInput(next, decimals, locale);
            setInvalid(next.trim() !== '' && parsed === null);
            onChange(parsed);
          }}
          className={`${inputClass} border-0 shadow-none focus:ring-0 focus:outline-none focus-visible:outline-none`}
        />
      </div>
      {invalid && (
        <p id={`${inputId}-err`} role="alert" className="text-xs text-red-700">
          Importe inválido (máx. {decimals} decimales)
        </p>
      )}
    </div>
  );
}
