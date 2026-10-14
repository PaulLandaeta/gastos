import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parses a value with a Zod schema, mapping failures to 422 VALIDATION_FAILED with field details. */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) fields[issue.path.join('.') || '(root)'] = issue.message;
    throw new AppError('VALIDATION_FAILED', 'Invalid request', { fields });
  }
  return result.data;
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Body must be valid JSON');
  }
}
