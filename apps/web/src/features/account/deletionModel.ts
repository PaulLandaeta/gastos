import { DELETE_ACCOUNT_CONFIRMATION, type DeletionPreview } from 'contracts';
import { formatMoney } from '../../lib/format';

type PreviewTrip = DeletionPreview['trips'][number];

/** FR-002: the exact word, a connection and no pending payments (FR-003). */
export function canConfirmDeletion(text: string, preview: DeletionPreview | undefined, online: boolean): boolean {
  return !!preview && !preview.blocked && online && text.trim() === DELETE_ACCOUNT_CONFIRMATION;
}

/** FR-001: what the deletion means for one trip, in plain words. */
export function tripConsequences(t: PreviewTrip): string[] {
  const lines: string[] = [];
  if (t.balanceMinor > 0) lines.push(`Te deben ${formatMoney(t.balanceMinor, t.currency)}; el saldo seguirá a nombre de un participante eliminado.`);
  else if (t.balanceMinor < 0) lines.push(`Debes ${formatMoney(-t.balanceMinor, t.currency)}; el saldo seguirá a nombre de un participante eliminado.`);
  else lines.push('Sin saldo pendiente.');
  if (t.role === 'creator') {
    lines.push(t.successor ? `${t.successor.displayName} pasará a ser la creadora del viaje.` : 'Eres la única persona del viaje: quedará anonimizado.');
  }
  const n = t.pendingSettlements.length;
  if (n > 0) lines.push(`${n} ${n === 1 ? 'pago pendiente' : 'pagos pendientes'} de confirmar: resuélvelos antes de borrar la cuenta.`);
  return lines;
}
