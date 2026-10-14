/**
 * ISO 4217 List One (active currencies) → number of minor-unit decimals.
 * Source: SIX Financial Information ISO 4217 list. Fund/precious-metal codes without a
 * minor unit ("N.A.") are excluded. Reviewed manually; update via constitution amendment
 * process when ISO publishes changes.
 */
const ZERO = [
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND',
  'VUV', 'XAF', 'XOF', 'XPF',
] as const;

const THREE = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'] as const;

const FOUR = ['CLF', 'UYW'] as const;

const TWO = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM', 'BBD', 'BDT',
  'BGN', 'BMD', 'BND', 'BOB', 'BOV', 'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF',
  'CHE', 'CHF', 'CHW', 'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK', 'DKK', 'DOP', 'DZD',
  'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GTQ', 'GYD',
  'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IRR', 'JMD', 'KES', 'KGS', 'KHR', 'KPW',
  'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT',
  'MOP', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK',
  'NPR', 'NZD', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'QAR', 'RON', 'RSD', 'RUB', 'SAR',
  'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP',
  'SZL', 'THB', 'TJS', 'TMT', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'USD', 'USN', 'UYU',
  'UZS', 'VED', 'VES', 'WST', 'XCD', 'XCG', 'YER', 'ZAR', 'ZMW', 'ZWG',
] as const;

export type CurrencyCode =
  | (typeof ZERO)[number]
  | (typeof TWO)[number]
  | (typeof THREE)[number]
  | (typeof FOUR)[number];

const table = new Map<string, number>([
  ...ZERO.map((c) => [c, 0] as const),
  ...TWO.map((c) => [c, 2] as const),
  ...THREE.map((c) => [c, 3] as const),
  ...FOUR.map((c) => [c, 4] as const),
]);

export const CURRENCY_CODES: readonly CurrencyCode[] = [...table.keys()].sort() as CurrencyCode[];

export function isCurrency(code: string): code is CurrencyCode {
  return table.has(code);
}

/** Number of decimals of the currency's minor unit, or `undefined` if not an ISO 4217 code. */
export function currencyDecimals(code: string): number | undefined {
  return table.get(code);
}
