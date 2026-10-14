/** FR-018: daily backups of the last 7 days plus the Sunday ones of the last 4 weeks. */
const DAY_MS = 86_400_000;
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

export const backupKind = (now: Date): 'daily' | 'weekly' => (now.getUTCDay() === 0 ? 'weekly' : 'daily');

/** Dates (YYYY-MM-DD) whose backups must be deleted. */
export function toDelete(dates: string[], now: Date): string[] {
  const sorted = [...new Set(dates)].sort().reverse();
  const keep = new Set(sorted.slice(0, 7));
  const horizon = now.getTime() - 28 * DAY_MS;
  for (const d of sorted) if (isSunday(d) && Date.parse(`${d}T00:00:00Z`) >= horizon) keep.add(d);
  return sorted.filter((d) => !keep.has(d));
}
