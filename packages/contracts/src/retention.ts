/** Days before expiry when the in-app notice appears (spec 004, Q3). */
export const EXPIRY_NOTICE_DAYS = 14;
export const RETENTION_MONTHS = 6;

/** Adds calendar months in UTC; if the day does not exist in the target month, uses its last day. */
export function addCalendarMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** RF-53: attachments expire six calendar months after upload. */
export const attachmentExpiry = (uploadedAt: Date) => addCalendarMonths(uploadedAt, RETENTION_MONTHS);

export function isExpiringSoon(expiresAt: Date, now: Date, days = EXPIRY_NOTICE_DAYS): boolean {
  const ms = expiresAt.getTime() - now.getTime();
  return ms > 0 && ms <= days * 24 * 60 * 60 * 1000;
}
