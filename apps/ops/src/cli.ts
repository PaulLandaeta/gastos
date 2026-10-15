import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pruneBackups, runBackup } from './backup.js';
import { parseKey } from './crypto.js';
import { opsEnv } from './env.js';
import { preflight } from './preflight.js';
import { exportDeletedUids, receiptStorage, runRestore } from './restore.js';
import { formatReport, runSmoke } from './smoke.js';
import { storeFromEnv } from './store.js';
import { lookupAuthUsers } from '../../api/src/auth/identityToolkit.js';
import { Firestore } from '../../api/src/firestore/client.js';
import { reconcileDeletions } from '../../api/src/services/accountDeletion.js';

const USAGE = `Uso: pnpm --filter ops ops <comando> [opciones]
  preflight [--offline]                         Comprueba la configuración de producción
  smoke --app <url> --api <url> [--light]       Verificación posterior al despliegue / uptime
  backup                                        Copia cifrada de Firestore (BACKUP_KEY, BACKUP_DIR o BACKUP_B2_*)
  prune                                         Borra las copias fuera de la retención 7 + 4
  restore --confirm-project <id> [--date YYYY-MM-DD] [--deleted-uids archivo.json] [--allow-non-empty]
  deletions-export --out archivo.json           Guarda los uids dados de baja (antes de vaciar una base)
  reconcile                                     Reaplica las bajas sobre la base actual`;

function flags(argv: string[]) {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}

const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
  const f = flags(rest);
  switch (command) {
    case 'preflight': {
      const repoRoot = fileURLToPath(new URL('../../..', import.meta.url).href);
      const problems = await preflight(repoRoot, { offline: f['offline'] === true });
      if (problems.length === 0) console.log('✓ Configuración de producción completa');
      else console.log(problems.map((p) => `✗ ${p}`).join('\n'));
      return problems.length === 0 ? 0 : 1;
    }
    case 'smoke': {
      const appUrl = str(f['app']) ?? process.env['APP_URL'];
      const apiUrl = str(f['api']) ?? process.env['API_URL'];
      if (!appUrl || !apiUrl) throw new Error('Indica --app y --api (o APP_URL y API_URL)');
      const report = await runSmoke({ appUrl, apiUrl, light: f['light'] === true });
      console.log(formatReport(report));
      return report.every((c) => c.ok) ? 0 : 1;
    }
    case 'backup': {
      const m = await runBackup(opsEnv(), storeFromEnv(), parseKey(process.env['BACKUP_KEY']));
      console.log(`✓ Copia ${m.date} (${m.kind}): ${m.docCount} documentos, ${m.bytes} bytes cifrados`);
      return 0;
    }
    case 'prune': {
      const removed = await pruneBackups(storeFromEnv());
      console.log(removed.length ? `✓ Borradas: ${removed.join(', ')}` : '✓ Nada que borrar');
      return 0;
    }
    case 'restore': {
      const confirmProject = str(f['confirm-project']);
      if (!confirmProject) throw new Error('Indica --confirm-project <id del proyecto destino>');
      const file = str(f['deleted-uids']);
      const deletedUids = file ? (JSON.parse(await readFile(file, 'utf8')) as string[]) : [];
      const date = str(f['date']);
      const r = await runRestore(opsEnv(), storeFromEnv(), parseKey(process.env['BACKUP_KEY']), {
        confirmProject,
        deletedUids,
        allowNonEmpty: f['allow-non-empty'] === true,
        ...(date ? { date } : {}),
      });
      console.log(`✓ Restaurada la copia ${r.date}: ${r.documents} documentos; bajas reaplicadas: ${r.reappliedDeletions}`);
      return 0;
    }
    case 'deletions-export': {
      const out = str(f['out']);
      if (!out) throw new Error('Indica --out <archivo.json>');
      const uids = await exportDeletedUids(opsEnv());
      await writeFile(out, JSON.stringify(uids));
      console.log(`✓ ${uids.length} bajas guardadas en ${out}`);
      return 0;
    }
    case 'reconcile': {
      const env = opsEnv();
      const done = await reconcileDeletions(new Firestore(env), receiptStorage(env), env, { lookupAuth: (u) => lookupAuthUsers(env, u) });
      console.log(`✓ Bajas reaplicadas: ${done.length}`);
      return 0;
    }
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    // Never print stack traces with data: only the message.
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
