import { AppError } from '../http/errors.js';
import type { DuplicateCheck, ExpenseDoc } from './expenses.js';
import { canViewExpense } from './visibility.js';

/**
 * RF-22 / FR-031: same trip, same transaction date, same total and at least one payer in common
 * with an active expense → POSSIBLE_DUPLICATE (unless confirmed). The similar expense is only
 * described when the caller may see it (RF-38); otherwise the warning carries no details.
 */
export const checkDuplicates: DuplicateCheck = async (tx, loaded, body, payerUids) => {
  const candidates = await tx.query(`trips/${loaded.trip.id}/expenses`, {
    where: [
      ['status', '==', 'active'],
      ['transactionDate', '==', body.transactionDate],
      ['totalMinor', '==', body.totalMinor],
    ],
    limit: 20,
  });
  const similar = candidates.find((d) => ((d.data['payerUids'] as string[] | undefined) ?? []).some((u) => payerUids.includes(u)));
  if (!similar) return;
  const expense = similar.data as unknown as ExpenseDoc;
  const visible = canViewExpense(loaded.me.data, expense);
  throw new AppError(
    'POSSIBLE_DUPLICATE',
    'A similar expense already exists',
    visible
      ? {
          similar: {
            id: similar.id,
            description: expense.description,
            transactionDate: expense.transactionDate,
            totalMinor: expense.totalMinor,
          },
        }
      : undefined,
  );
};
