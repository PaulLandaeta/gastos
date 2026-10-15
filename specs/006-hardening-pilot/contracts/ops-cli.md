# Ops CLI — `pnpm --filter ops ops <comando>`

Todas las opciones también se leen de variables de entorno. Ningún comando imprime PII ni secretos. Código de salida
0 = éxito.

| Comando | Entradas | Efecto |
|---|---|---|
| `preflight` | `wrangler.jsonc`, `apps/web/.env.production`, `wrangler secret list`, `.firebaserc` | Lista de problemas; sale con 1 si hay alguno. `--offline` omite la consulta de secretos. |
| `smoke` | `APP_URL`, `API_URL` (`--light`: solo health con `deep` y carga de la app) | Ejecuta las comprobaciones de R10 e imprime un informe ✓/✗; sale con 1 si alguna falla. |
| `backup` | `FIREBASE_SERVICE_ACCOUNT` o `FIRESTORE_EMULATOR_HOST`; `BACKUP_KEY`; destino `BACKUP_DIR` o `BACKUP_B2_*` | Exporta, cifra y sube `backup.gvb` y `manifest.json`. Imprime recuentos. |
| `prune` | destino | Borra las copias fuera de la retención 7 + 4. |
| `restore` | `--date YYYY-MM-DD`; origen; destino Firestore; `--confirm-project <id>` | Descifra, verifica el sha256, escribe todo y ejecuta `reconcile`. Se niega si el proyecto destino no coincide con `--confirm-project`. |
| `reconcile` | destino Firestore (+ Auth) | Reaplica las bajas del registro y de los uids sin cuenta de Auth. |

Variables de backup en B2:
- `BACKUP_B2_ENDPOINT`
- `BACKUP_B2_REGION`
- `BACKUP_B2_BUCKET`
- `BACKUP_B2_KEY_ID`
- `BACKUP_B2_APPLICATION_KEY`
