import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/http/errors.js';
import { FakeReceiptProvider } from '../../src/providers/fakeAi.js';
import { GeminiReceiptProvider } from '../../src/providers/gemini.js';
import { OpenAiReceiptProvider } from '../../src/providers/openai.js';

const file = { mimeType: 'image/jpeg', data: new Uint8Array([255, 216, 255]) };

describe('GeminiReceiptProvider', () => {
  it('sends inline data, a JSON response schema and the configured model; parses the draft', async () => {
    let captured: { url: string; key: string | null; body: Record<string, unknown> } | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      captured = { url: req.url, key: req.headers.get('x-goog-api-key'), body: (await req.json()) as Record<string, unknown> };
      const draft = { items: [{ description: 'Pan', quantity: 2, total: 6 }], total: { value: 6, confidence: 0.9 } };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }] });
    };
    const g = new GeminiReceiptProvider({ apiKey: 'k', model: 'flash-x' }, fetchImpl);
    const out = await g.extract({ files: [file], currencyHint: 'USD' });
    expect(out.items[0]).toMatchObject({ description: 'Pan', quantity: 2, total: 6 });
    expect(captured!.url).toContain('/models/flash-x:generateContent');
    expect(captured!.key).toBe('k');
    const body = captured!.body as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> };
    expect(body.contents[0]!.parts.some((p) => 'inline_data' in p)).toBe(true);
    expect(body.generationConfig['responseMimeType']).toBe('application/json');
    expect(body.generationConfig['responseSchema']).toBeTruthy();
  });

  it.each([
    ['invalid JSON', () => Response.json({ candidates: [{ content: { parts: [{ text: '{not json' }] } }] })],
    ['schema mismatch', () => Response.json({ candidates: [{ content: { parts: [{ text: '{"items":"x"}' }] } }] })],
    ['429', () => new Response('quota', { status: 429 })],
    ['500', () => new Response('boom', { status: 500 })],
  ])('maps %s to AI_UNAVAILABLE', async (_label, respond) => {
    const g = new GeminiReceiptProvider({ apiKey: 'k', model: 'm' }, async () => respond());
    await expect(g.extract({ files: [file], currencyHint: 'USD' })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    await expect(g.extract({ files: [file], currencyHint: 'USD' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('OpenAiReceiptProvider', () => {
  it('sends images and PDFs inline with a strict JSON schema; strips nulls and parses the draft', async () => {
    let captured: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const req = new Request(input as RequestInfo, init);
      captured = { url: req.url, auth: req.headers.get('authorization'), body: (await req.json()) as Record<string, unknown> };
      const draft = {
        merchant: { value: 'Panadería', confidence: 0.9 },
        transactionDate: null,
        detectedCurrency: 'BOB',
        items: [{ description: 'Pan', quantity: 2, unitPrice: null, total: 6, confidence: 0.8 }],
        subtotal: null,
        tax: null,
        tip: null,
        discount: null,
        total: { value: 6, confidence: 0.9 },
      };
      return Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }] });
    };
    const o = new OpenAiReceiptProvider({ apiKey: 'k', model: 'mini-x' }, fetchImpl);
    const pdf = { mimeType: 'application/pdf', data: new Uint8Array([37, 80, 68, 70]) };
    const out = await o.extract({ files: [file, pdf], currencyHint: 'BOB' });
    expect(out.items[0]).toMatchObject({ description: 'Pan', quantity: 2, total: 6 });
    expect(out.items[0]).not.toHaveProperty('unitPrice');
    expect(out).not.toHaveProperty('transactionDate');
    expect(out.total).toMatchObject({ value: 6 });
    expect(captured!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(captured!.auth).toBe('Bearer k');
    const body = captured!.body as {
      model: string;
      store: boolean;
      messages: { content: { type: string }[] }[];
      response_format: { json_schema: { strict: boolean } };
    };
    expect(body.model).toBe('mini-x');
    expect(body.store).toBe(false);
    expect(body.messages[0]!.content.map((p) => p.type)).toEqual(['text', 'image_url', 'file']);
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it.each([
    ['invalid JSON', () => Response.json({ choices: [{ message: { content: '{not json' } }] })],
    ['refusal', () => Response.json({ choices: [{ message: { content: null, refusal: 'no' } }] })],
    ['429', () => new Response('quota', { status: 429 })],
    ['500', () => new Response('boom', { status: 500 })],
  ])('maps %s to AI_UNAVAILABLE', async (_label, respond) => {
    const o = new OpenAiReceiptProvider({ apiKey: 'k', model: 'm' }, async () => respond());
    await expect(o.extract({ files: [file], currencyHint: 'USD' })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('FakeReceiptProvider', () => {
  it('is deterministic and fails on a FAIL marker', async () => {
    const f = new FakeReceiptProvider();
    const a = await f.extract({ files: [file], currencyHint: 'USD' });
    expect(await f.extract({ files: [file], currencyHint: 'USD' })).toEqual(a);
    expect(a.items.length).toBeGreaterThan(0);
    await expect(
      f.extract({ files: [{ mimeType: 'image/png', data: new TextEncoder().encode('FAIL please') }], currencyHint: 'USD' }),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});
