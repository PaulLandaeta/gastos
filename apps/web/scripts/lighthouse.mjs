// Feature 006 (SC-007, research R11): Lighthouse (mobile) on the production build of /login.
// Usage: node scripts/lighthouse.mjs [url] [runs]   (expects `vite preview` already serving the build)
// Shared CI runners make the performance score noisy (±8 points), so each category uses the median of several runs.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5181/login';
const runs = Number(process.argv[3] ?? 3);
const THRESHOLDS = { accessibility: 0.9, 'best-practices': 0.9, performance: 0.8 };
const dir = mkdtempSync(join(tmpdir(), 'lh-'));

const reports = [];
for (let i = 0; i < runs; i++) {
  const out = join(dir, `report-${i}.json`);
  execFileSync(
    'npx',
    [
      '-y',
      'lighthouse@12.8.2',
      url,
      '--only-categories=performance,accessibility,best-practices',
      '--form-factor=mobile',
      '--output=json',
      `--output-path=${out}`,
      '--quiet',
      '--chrome-flags=--headless=new --no-sandbox',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  reports.push(JSON.parse(readFileSync(out, 'utf8')));
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let failed = false;
for (const [id, min] of Object.entries(THRESHOLDS)) {
  const scores = reports.map((r) => r.categories[id].score);
  const score = median(scores);
  const ok = score >= min;
  failed ||= !ok;
  const all = scores.map((s) => Math.round(s * 100)).join(', ');
  console.log(`${ok ? '✓' : '✗'} ${reports[0].categories[id].title}: ${Math.round(score * 100)} (mínimo ${min * 100}; ejecuciones: ${all})`);
}
process.exit(failed ? 1 : 0);
