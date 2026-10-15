import type { RoastEntry } from 'finance-engine';
import { describe, expect, it } from 'vitest';
import { ROAST_LABELS, roastSentence } from '../../src/features/roast/roastCopy';
import { formatMoney } from '../../src/lib/format';

const entry = (over: Partial<RoastEntry>): RoastEntry => ({
  uid: 'beto',
  netMinor: -12000,
  debtMinor: 12000,
  tier: 'top',
  owes: [{ toUid: 'ana', amountMinor: 12000 }],
  mainOwnerUid: 'ana',
  ...over,
});
const names: Record<string, string> = { beto: 'Beto', ana: 'Ana', carla: 'Carla', dani: 'Dani' };
const name = (uid: string) => names[uid] ?? 'Participante';
const eur = (minor: number) => formatMoney(minor, 'EUR');

describe('roast copy (feature 007)', () => {
  it('has the fixed MVP labels', () => {
    expect(ROAST_LABELS).toEqual({
      top: 'La más zorra del grupo',
      golfa: 'Golfa barata',
      senorita: 'Señorita',
      macho: 'Macho caporal',
    });
  });

  it('names the debt and the main owner for every debtor tier', () => {
    expect(roastSentence(entry({}), name, 'EUR')).toBe(`Beto es la más zorra del grupo: le debe ${eur(12000)} a Ana.`);
    expect(roastSentence(entry({ uid: 'carla', debtMinor: 7000, tier: 'golfa' }), name, 'EUR')).toBe(
      `Carla es una golfa barata: le debe ${eur(7000)} a Ana.`,
    );
    expect(roastSentence(entry({ uid: 'dani', debtMinor: 1500, tier: 'senorita' }), name, 'EUR')).toBe(
      `Dani es una señorita: solo le debe ${eur(1500)} a Ana.`,
    );
  });

  it('macho caporal has no amount', () => {
    expect(roastSentence(entry({ uid: 'ana', netMinor: 15000, debtMinor: 0, tier: 'macho', owes: [], mainOwnerUid: null }), name, 'EUR')).toBe(
      'Ana es macho caporal: no le debe nada a nadie.',
    );
  });

  it('omits the owner when the view has none', () => {
    expect(roastSentence(entry({ owes: [], mainOwnerUid: null }), name, 'EUR')).toBe(`Beto es la más zorra del grupo: debe ${eur(12000)}.`);
  });
});
