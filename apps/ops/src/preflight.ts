import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Removes // and /* *\/ comments from JSONC, leaving string contents untouched. */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  return out;
}

export interface ConfigInput {
  /** apps/api/wrangler.jsonc contents. */
  wrangler: string;
  /** apps/web/.env.production parsed, or null if the file is missing. */
  webEnv: Record<string, string> | null;
  /** Names from `wrangler secret list`, or null when they could not be listed (--offline). */
  secrets: string[] | null;
  /** .firebaserc contents. */
  firebaserc: string;
}

const PLACEHOLDER = /REPLACE_WITH/;
const WEB_REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_API_URL'];

/** FR-014: everything a production deploy needs, checked before publishing anything. */
export function checkConfig(input: ConfigInput): string[] {
  const problems: string[] = [];
  const wrangler = JSON.parse(stripJsonComments(input.wrangler)) as { vars?: Record<string, string> };
  const vars = wrangler.vars ?? {};
  for (const [k, v] of Object.entries(vars)) {
    if (PLACEHOLDER.test(v)) problems.push(`wrangler.jsonc: ${k} todavía tiene un valor de ejemplo (REPLACE_WITH…)`);
  }
  if (vars['ENVIRONMENT'] !== 'production') problems.push('wrangler.jsonc: ENVIRONMENT debe ser production');
  const origins = (vars['ALLOWED_ORIGINS'] ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0 || origins.some((o) => !o.startsWith('https://'))) problems.push('wrangler.jsonc: ALLOWED_ORIGINS debe contener solo orígenes https');
  const project = vars['FIREBASE_PROJECT_ID'] ?? '';

  if (!input.webEnv) problems.push('Falta apps/web/.env.production (copia apps/web/.env.production.example)');
  else {
    for (const k of WEB_REQUIRED) if (!input.webEnv[k]) problems.push(`apps/web/.env.production: falta ${k}`);
    for (const [k, v] of Object.entries(input.webEnv)) if (PLACEHOLDER.test(v)) problems.push(`apps/web/.env.production: ${k} todavía tiene un valor de ejemplo`);
    if (input.webEnv['VITE_USE_EMULATORS'] === 'true') problems.push('apps/web/.env.production: VITE_USE_EMULATORS no puede ser true en producción');
    const apiUrl = input.webEnv['VITE_API_URL'];
    if (apiUrl && !apiUrl.startsWith('https://')) problems.push('apps/web/.env.production: VITE_API_URL debe ser https');
    const webProject = input.webEnv['VITE_FIREBASE_PROJECT_ID'];
    if (webProject && project && webProject !== project) {
      problems.push(`apps/web/.env.production: VITE_FIREBASE_PROJECT_ID (${webProject}) no coincide con FIREBASE_PROJECT_ID (${project})`);
    }
  }

  if (input.secrets) {
    const required = ['FIREBASE_SERVICE_ACCOUNT', 'B2_KEY_ID', 'B2_APPLICATION_KEY', ...(vars['AI_PROVIDER'] === 'gemini' ? ['GEMINI_API_KEY'] : [])];
    for (const s of required) if (!input.secrets.includes(s)) problems.push(`Falta el secreto del Worker ${s}`);
  }

  const prod = (JSON.parse(input.firebaserc) as { projects?: Record<string, string> }).projects?.['prod'];
  if (!prod || PLACEHOLDER.test(prod)) problems.push('.firebaserc: falta el alias "prod" con el proyecto de producción');
  else if (project && prod !== project) problems.push(`.firebaserc: el alias prod (${prod}) no coincide con FIREBASE_PROJECT_ID (${project})`);
  return problems;
}

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Reads the real files of the repository (and the Worker secrets unless offline). */
export async function preflight(repoRoot: string, opts: { offline?: boolean } = {}): Promise<string[]> {
  const read = (p: string) => readFile(join(repoRoot, p), 'utf8');
  const webEnvText = await read('apps/web/.env.production').catch(() => null);
  let secrets: string[] | null = null;
  if (!opts.offline) {
    try {
      const out = execFileSync('pnpm', ['--filter', 'api', 'exec', 'wrangler', 'secret', 'list', '--format', 'json'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      secrets = (JSON.parse(out.slice(out.indexOf('['))) as { name: string }[]).map((s) => s.name);
    } catch {
      return ['No se pudieron listar los secretos del Worker (¿wrangler login?). Usa --offline para omitir esta comprobación.'];
    }
  }
  return checkConfig({
    wrangler: await read('apps/api/wrangler.jsonc'),
    webEnv: webEnvText === null ? null : parseDotEnv(webEnvText),
    secrets,
    firebaserc: await read('.firebaserc'),
  });
}
