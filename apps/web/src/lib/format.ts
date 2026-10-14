import { minorUnits } from 'finance-engine';

/**
 * Formats an integer amount in minor units without floating-point math: the decimal string is
 * built from the integer and handed to Intl as a string (exact formatting).
 */
export function formatMoney(amountMinor: number, currency: string, locale = 'es'): string {
  const decimals = minorUnits(currency);
  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(decimals + 1, '0');
  const decimal =
    decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // Intl accepts decimal strings (exact) per ECMA-402 NumberFormat v3.
  return formatter.format(`${negative ? '-' : ''}${decimal}` as unknown as number);
}

export function formatDate(isoDate: string, locale = 'es'): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatDateRange(start: string, end: string, locale = 'es'): string {
  return `${formatDate(start, locale)} – ${formatDate(end, locale)}`;
}
