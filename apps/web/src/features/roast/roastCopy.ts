import type { RoastEntry, RoastTier } from 'finance-engine';
import { formatMoney } from '../../lib/format';

/** Feature 007 (RF-57): fixed labels for the MVP; customising them is out of scope. */
export const ROAST_LABELS: Record<RoastTier, string> = {
  top: 'La más zorra del grupo',
  golfa: 'Golfa barata',
  senorita: 'Señorita',
  macho: 'Macho caporal',
};

const PREFIX: Record<Exclude<RoastTier, 'macho'>, string> = {
  top: 'es la más zorra del grupo: ',
  golfa: 'es una golfa barata: ',
  senorita: 'es una señorita: solo ',
};

/** The mocking sentence: total debt and main owner in the active view. */
export function roastSentence(entry: RoastEntry, name: (uid: string) => string, currency: string): string {
  if (entry.tier === 'macho') return `${name(entry.uid)} es macho caporal: no le debe nada a nadie.`;
  const amount = formatMoney(entry.debtMinor, currency);
  const owner = entry.mainOwnerUid ? `le debe ${amount} a ${name(entry.mainOwnerUid)}` : `debe ${amount}`;
  return `${name(entry.uid)} ${PREFIX[entry.tier]}${owner}.`;
}
