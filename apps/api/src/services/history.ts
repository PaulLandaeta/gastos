import type { Firestore } from '../firestore/client.js';
import { notFound } from '../http/errors.js';
import { expensePath, type ExpenseDoc } from './expenses.js';
import { loadTripForMember } from './tripRepo.js';
import { canViewExpense } from './visibility.js';

/** FR-030: expense history, visible only to whoever can see the expense (404 otherwise). */
export async function getExpenseHistory(db: Firestore, tripId: string, expenseId: string, uid: string) {
  return db.runTransaction(async (tx) => {
    const { me } = await loadTripForMember(tx, tripId, uid);
    const doc = await tx.get(expensePath(tripId, expenseId));
    if (!doc || !canViewExpense(me.data, doc.data as unknown as ExpenseDoc)) throw notFound('Expense');
    const events = await tx.query(`trips/${tripId}/auditEvents`, {
      where: [['entityId', '==', expenseId]],
      orderBy: [['timestamp', 'asc']],
    });
    return {
      events: events.map((e) => ({
        action: e.data['action'] as string,
        actorUid: e.data['actorUid'] as string,
        timestamp: (e.data['timestamp'] as Date).toISOString(),
        afterVersion: (e.data['afterVersion'] as number | null) ?? null,
      })),
    };
  });
}
