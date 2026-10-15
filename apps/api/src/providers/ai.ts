import type { ReceiptAIProvider } from 'contracts';
import { isEmulator, type Env } from '../env.js';
import { FakeReceiptProvider } from './fakeAi.js';
import { GeminiReceiptProvider } from './gemini.js';
import { OpenAiReceiptProvider } from './openai.js';

export function createAiProvider(env: Env): ReceiptAIProvider {
  if (env.AI_PROVIDER === 'fake') {
    if (!isEmulator(env)) throw new Error('The fake AI provider is emulator-only');
    return new FakeReceiptProvider();
  }
  if (env.AI_PROVIDER === 'openai') {
    if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) throw new Error('OpenAI is not configured');
    return new OpenAiReceiptProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
  }
  if (!env.GEMINI_API_KEY || !env.GEMINI_MODEL) throw new Error('Gemini is not configured');
  return new GeminiReceiptProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
}
