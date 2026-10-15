import { Buffer } from 'node:buffer';
import { RawReceiptDraft, type ReceiptAIProvider } from 'contracts';
import { AppError } from '../http/errors.js';

// Strict structured outputs: every property is required and "absent" is expressed as null (stripped before Zod).
const num = { type: ['number', 'null'] };
const str = { type: ['string', 'null'] };
const scored = (value: object) => ({
  type: ['object', 'null'],
  properties: { value, confidence: num },
  required: ['value', 'confidence'],
  additionalProperties: false,
});

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    merchant: scored(str),
    transactionDate: scored(str),
    detectedCurrency: str,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, quantity: num, unitPrice: num, total: num, confidence: num },
        required: ['description', 'quantity', 'unitPrice', 'total', 'confidence'],
        additionalProperties: false,
      },
    },
    subtotal: num,
    tax: num,
    tip: num,
    discount: num,
    total: scored(num),
  },
  required: ['merchant', 'transactionDate', 'detectedCurrency', 'items', 'subtotal', 'tax', 'tip', 'discount', 'total'],
  additionalProperties: false,
};

const PROMPT = (currency: string) =>
  [
    'Extract the purchase receipt in the attached image(s)/PDF as JSON matching the schema.',
    'Amounts are decimal numbers exactly as printed (no currency symbols). transactionDate is YYYY-MM-DD.',
    'detectedCurrency is the ISO 4217 code printed on the receipt (the trip currency is ' + currency + ', do not convert).',
    'confidence is 0..1. Include every purchased line; do not invent items. Tax, tip and discount are totals for the receipt.',
    'Use null for anything not printed on the receipt.',
  ].join(' ');

/** Removes nulls recursively: the schema uses null for "absent", the shared draft schema uses missing keys. */
function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]));
  }
  return v;
}

const filePart = (f: { mimeType: string; data: Uint8Array }, i: number) => {
  const url = `data:${f.mimeType};base64,${Buffer.from(f.data).toString('base64')}`;
  return f.mimeType === 'application/pdf'
    ? { type: 'file', file: { filename: `receipt-${i + 1}.pdf`, file_data: url } }
    : { type: 'image_url', image_url: { url, detail: 'high' } };
};

/** RF-50: OpenAI adapter (Chat Completions, inline images/PDF, strict JSON schema). Key and model come from env. */
export class OpenAiReceiptProvider implements ReceiptAIProvider {
  readonly name = 'openai';
  readonly model: string;

  constructor(
    private readonly cfg: { apiKey: string; model: string; timeoutMs?: number },
    private readonly fetchImpl: typeof fetch = (i, init) => fetch(i, init),
  ) {
    this.model = cfg.model;
  }

  async extract(input: { files: { mimeType: string; data: Uint8Array }[]; currencyHint: string }) {
    const body = {
      model: this.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT(input.currencyHint) }, ...input.files.map(filePart)] }],
      response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema: RESPONSE_SCHEMA } },
      store: false,
    };
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 25_000),
      });
    } catch {
      throw new AppError('AI_UNAVAILABLE', 'The AI provider did not answer');
    }
    if (!res.ok) throw new AppError('AI_UNAVAILABLE', 'The AI provider failed', { status: res.status });
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: string | null; refusal?: string | null } }[] };
      const text = json.choices?.[0]?.message?.content ?? '';
      return RawReceiptDraft.parse(stripNulls(JSON.parse(text)));
    } catch {
      throw new AppError('AI_UNAVAILABLE', 'The AI provider returned an invalid draft');
    }
  }
}
