const SEPARATORS: Record<string, { decimal: '.' | ','; group: '.' | ',' }> = {
  en: { decimal: '.', group: ',' },
  es: { decimal: ',', group: '.' },
};

function separatorsFor(locale: string) {
  return SEPARATORS[locale.slice(0, 2).toLowerCase()] ?? SEPARATORS['es']!;
}

const isGrouped = (s: string, sep: string) => new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s);

/**
 * Parses user-typed money into an integer amount of minor units using string arithmetic only
 * (Constitution I: never floats). Accepts "," or "." as decimal separator according to the
 * locale, unambiguous thousands groups, and at most `decimals` fraction digits.
 * Returns `null` for empty, negative or invalid input.
 */
export function parseMoneyInput(text: string, decimals: number, locale = 'es'): number | null {
  const s = text.replace(/[\s\u00a0\u202f]/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const { decimal, group } = separatorsFor(locale);

  let intPart: string;
  let fracPart = '';
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;

  if (dots > 0 && commas > 0) {
    // Both present: the last one is the decimal separator, the other groups thousands.
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    if ((s.match(new RegExp(`\\${dec}`, 'g')) ?? []).length !== 1) return null;
    const [i, f] = s.split(dec) as [string, string];
    if (!isGrouped(i, grp)) return null;
    intPart = i.split(grp).join('');
    fracPart = f;
  } else if (dots + commas === 0) {
    intPart = s;
  } else {
    const sep = dots > 0 ? '.' : ',';
    const count = dots + commas;
    const [i, f = ''] = s.split(sep) as [string, string?];
    if (count > 1) {
      if (!isGrouped(s, sep)) return null;
      intPart = s.split(sep).join('');
    } else if (sep === group && f.length === 3 && isGrouped(s, sep)) {
      // e.g. "1.234" in es / "1,234" in en → thousands
      intPart = s.split(sep).join('');
    } else if (sep === decimal || f.length <= decimals) {
      intPart = i;
      fracPart = f;
    } else if (isGrouped(s, sep)) {
      intPart = s.split(sep).join('');
    } else {
      return null;
    }
  }

  if (intPart === '' && fracPart === '') return null;
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (fracPart.length > decimals) return null;
  const digits = (intPart || '0') + fracPart.padEnd(decimals, '0');
  const value = Number(digits.replace(/^0+(?=\d)/, ''));
  return Number.isSafeInteger(value) ? value : null;
}
