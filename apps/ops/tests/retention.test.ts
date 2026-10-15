import { describe, expect, it } from 'vitest';
import { backupKind, toDelete } from '../src/retention.js';

const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10));

describe('backup retention: 7 daily + 4 weekly (FR-018)', () => {
  it('keeps the last 7 dates and the Sundays of the last 28 days', () => {
    const now = new Date('2026-10-14T04:00:00Z'); // Wednesday
    const all = days('2026-10-14', 60);
    const kept = all.filter((d) => !toDelete(all, now).includes(d));
    expect(kept).toEqual([
      '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08',
      // Sundays within 28 days (10-11 already kept above)
      '2026-10-04', '2026-09-27', '2026-09-20',
    ]);
  });

  it('never deletes when there are 7 or fewer backups', () => {
    const now = new Date('2026-10-14T04:00:00Z');
    expect(toDelete(['2026-01-01', '2026-02-01'], now)).toEqual([]);
  });

  it('labels Sunday backups as weekly', () => {
    expect(backupKind(new Date('2026-10-11T03:30:00Z'))).toBe('weekly');
    expect(backupKind(new Date('2026-10-14T03:30:00Z'))).toBe('daily');
  });
});
