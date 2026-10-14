import type { InvitationStatus, Role, TripStatus } from 'contracts';

interface MemberLike {
  uid: string | null;
  role: Role;
  invitationStatus: InvitationStatus;
}

interface ExpenseLike {
  createdBy: string;
  payers: { uid: string }[];
  items: { beneficiaries: string[] }[];
  viewerUids?: string[];
  status?: 'active' | 'voided';
}

const MANAGERS: Role[] = ['creator', 'admin'];

/** RF-38: who may see an expense's detail besides managers — payers ∪ beneficiaries ∪ author. */
export function viewerUidsOf(expense: ExpenseLike): string[] {
  const set = new Set<string>([expense.createdBy]);
  for (const p of expense.payers) set.add(p.uid);
  for (const i of expense.items) for (const b of i.beneficiaries) set.add(b);
  return [...set].sort();
}

/** Same rule as Security Rules (`firebase/firestore.rules`): keep both in sync (parity test). */
export function canViewExpense(member: MemberLike, expense: ExpenseLike): boolean {
  if (member.invitationStatus !== 'accepted' || !member.uid) return false;
  if (MANAGERS.includes(member.role)) return true;
  return (expense.viewerUids ?? viewerUidsOf(expense)).includes(member.uid);
}

/** RF-10/RF-29: author, creator or admin may void an active expense of a mutable trip. */
export function canVoidExpense(member: MemberLike, expense: ExpenseLike, tripStatus: TripStatus): boolean {
  if (member.invitationStatus !== 'accepted' || !member.uid) return false;
  if (tripStatus === 'closed' || tripStatus === 'archived') return false;
  if ((expense.status ?? 'active') !== 'active') return false;
  return expense.createdBy === member.uid || MANAGERS.includes(member.role);
}
