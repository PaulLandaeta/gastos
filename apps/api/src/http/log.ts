import { redact } from '../services/audit.js';

/** Structured JSON logs. E-mails are masked; never log names, item amounts or tokens (Principle II). */
export function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify(redact({ level, event, ...fields }));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
