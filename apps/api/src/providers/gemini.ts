import { Buffer } from 'node:buffer';
import { RawReceiptDraft, type ReceiptAIProvider } from 'contracts';
import { AppError } from '../http/errors.js';

const scored = (type: string) => ({ type: 'OBJECT', properties: { value: { type }, confidence: { type: 'NUMBER' } } });

/** Gemini structured-output schema (OpenAPI subset). Output is validated again with Zod. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: scored('STRING'),
    transactionDate: scored('STRING'),
    detectedCurrency: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unitPrice: { type: 'NUMBER' },
          total: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
        },
        required: ['description'],
      },
    },
    subtotal: { type: 'NUMBER' },
    tax: { type: 'NUMBER' },
    tip: { type: 'NUMBER' },
    discount: { type: 'NUMBER' },
    total: scored('NUMBER'),
  },
  required: ['items'],
};

const PROMPT = (currency: string) =>
  [
    'Extract the purchase receipt in the attached image(s)/PDF as JSON matching the schema.',
    'Amounts are decimal numbers exactly as printed (no currency symbols). transactionDate is YYYY-MM-DD.',
    'detectedCurrency is the ISO 4217 code printed on the receipt (the trip currency is ' + currency + ', do not convert).',
    'confidence is 0..1. Include every purchased line; do not invent items. Tax, tip and discount are totals for the receipt.',
  ].join(' ');

/** RF-50: Gemini adapter (REST, inline data, structured JSON). Key and model come from env. */
export class GeminiReceiptProvider implements ReceiptAIProvider {
  readonly name = 'gemini';
  readonly model: string;

  constructor(
    private readonly cfg: { apiKey: string; model: string; timeoutMs?: number },
    private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  ) {
    this.model = cfg.model;
  }

  async extract(input: { files: { mimeType: string; data: Uint8Array }[]; currencyHint: string }) {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT(input.currencyHint) },
            ...input.files.map((f) => ({ inline_data: { mime_type: f.mimeType, data: Buffer.from(f.data).toString('base64') } })),
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.cfg.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 25_000),
      });
    } catch {
      throw new AppError('AI_UNAVAILABLE', 'The AI provider did not answer');
    }
    if (!res.ok) throw new AppError('AI_UNAVAILABLE', 'The AI provider failed', { status: res.status });
    try {
      const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      return RawReceiptDraft.parse(JSON.parse(text));
    } catch {
      throw new AppError('AI_UNAVAILABLE', 'The AI provider returned an invalid draft');
    }
  }
}
