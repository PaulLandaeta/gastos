import type { RawReceiptDraft, ReceiptAIProvider } from 'contracts';
import { AppError } from '../http/errors.js';

/**
 * Deterministic provider for the emulator and tests (no network, no cost). A file whose bytes start
 * with "FAIL" simulates a provider outage.
 */
export class FakeReceiptProvider implements ReceiptAIProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';

  async extract(input: { files: { mimeType: string; data: Uint8Array }[]; currencyHint: string }): Promise<RawReceiptDraft> {
    const head = new TextDecoder().decode(input.files[0]?.data.slice(0, 4) ?? new Uint8Array());
    if (head === 'FAIL') throw new AppError('AI_UNAVAILABLE', 'Simulated provider outage');
    return {
      merchant: { value: 'Super Ahorro', confidence: 0.95 },
      // Yesterday (UTC): a plausible, never-future transaction date.
      transactionDate: { value: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), confidence: 0.9 },
      detectedCurrency: 'EUR',
      items: [
        { description: 'Pan', quantity: 2, unitPrice: 3, total: 6, confidence: 0.95 },
        { description: 'Agua', quantity: 1, unitPrice: 3, total: 3, confidence: 0.5 },
      ],
      subtotal: 9,
      tax: 0.9,
      tip: 0,
      discount: 0,
      total: { value: 9.9, confidence: 0.97 },
    };
  }
}
