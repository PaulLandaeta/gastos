# Operación: monitoreo, backups y costos

## Monitoreo y alertas

| Señal | Dónde | Alerta |
|---|---|---|
| Disponibilidad de app y API | `.github/workflows/uptime.yml`, cada 15 min, ejecuta `ops smoke --light` (`GET /v1/health?deep=1` y carga de la app) | Correo de GitHub cuando falla. Hay que activar *Settings → Notifications → Actions → failed workflows*. |
| Copias de seguridad | `.github/workflows/backup.yml`, diario a las 03:30 UTC | Correo de GitHub si falla. |
| Errores y latencia de la API | Cloudflare → Workers → *Observability*: una línea `request` por petición | Revisión manual. |
| Cuotas de Firestore | Consola de Firebase → *Usage* | Revisión semanal (ver umbrales). |
| Cuotas de IA | `GET /v1/admin/ai-usage` (`ADMIN_UIDS`) | La app avisa al agotarse. |

Para activar el uptime, define las variables del repositorio `APP_URL` (`https://<proyecto>.web.app`) y `API_URL`
(URL del Worker, sin `/v1`).

> GitHub desactiva los workflows programados de repositorios **sin actividad durante 60 días**. Se reactivan en
> *Actions → Uptime/Backup → Enable workflow*.
>
> Si no quieres depender de esto, crea un monitor HTTP gratuito en UptimeRobot (sin tarjeta, cada 5 min) contra
> `<API_URL>/v1/health?deep=1`.

### Investigar un error

1. El usuario ve un mensaje de error. Toda respuesta de la API lleva la cabecera `x-correlation-id`, visible en
   DevTools → Network.
2. En Workers Observability, filtra por `correlationId`. Encontrarás:
   - la línea `request`, con `route` (patrón, sin ids), `status`, `code` y `ms`;
   - si hubo un error interno, la línea `unhandled_error`.
3. Los registros nunca contienen correos, nombres, importes por ítem ni tokens. El test `apps/api/tests/ops.test.ts`
   lo verifica.

## Copias de seguridad

- **Qué**: todos los documentos de Firestore, exportados por REST (`apps/ops`).
- **Formato**: NDJSON comprimido y cifrado con AES-256-GCM, en `firestore/YYYY-MM-DD/backup.gvb`, junto a un
  `manifest.json` sin datos personales (recuentos y sha256).
- **Dónde**: bucket B2 privado `…-backups`, distinto del de comprobantes.
- **Retención**: 7 diarias y las de domingo de las últimas 4 semanas, como máximo unos 35 días.
- **Pérdida máxima**: 24 h.

Secretos y variables del repositorio para `backup.yml`:

| Tipo | Nombre |
|---|---|
| Secretos | `FIREBASE_SERVICE_ACCOUNT` (cuenta de solo lectura), `BACKUP_KEY` (`openssl rand -base64 32`), `BACKUP_B2_KEY_ID`, `BACKUP_B2_APPLICATION_KEY` |
| Variables | `FIREBASE_PROJECT_ID`, `BACKUP_B2_ENDPOINT`, `BACKUP_B2_REGION`, `BACKUP_B2_BUCKET` |

> **Guarda `BACKUP_KEY` también fuera de GitHub**, en un gestor de contraseñas. Sin ella las copias no se pueden
> descifrar.

Para hacer una copia manual en un directorio local:

```bash
FIREBASE_PROJECT_ID=<proyecto> FIREBASE_SERVICE_ACCOUNT="$(cat sa.json)" BACKUP_KEY=<clave> BACKUP_DIR=./copias \
  pnpm --filter ops ops backup
```

### Restaurar (objetivo: menos de 1 h)

1. **Si la base sigue accesible**, guarda primero las bajas registradas, porque podrían ser posteriores a la copia:
   ```bash
   pnpm --filter ops ops deletions-export --out bajas.json
   ```
2. **Vacía la base de destino.** La restauración se niega a escribir sobre datos existentes.
   ```bash
   npx firebase-tools firestore:delete --all-collections --project prod
   ```
3. **Restaura** con la service account de la API, que tiene escritura:
   ```bash
   FIREBASE_PROJECT_ID=<proyecto> FIREBASE_SERVICE_ACCOUNT="$(cat sa-api.json)" BACKUP_KEY=<clave> \
   BACKUP_B2_ENDPOINT=… BACKUP_B2_REGION=… BACKUP_B2_BUCKET=… BACKUP_B2_KEY_ID=… BACKUP_B2_APPLICATION_KEY=… \
     pnpm --filter ops ops restore --confirm-project <proyecto> [--date YYYY-MM-DD] [--deleted-uids bajas.json]
   ```
   - Verifica el sha256 y escribe por lotes de 500.
   - Al terminar **reaplica las bajas de cuenta** que la copia no refleja. Usa el registro restaurado, el archivo
     `bajas.json` y los usuarios que ya no tienen cuenta en Firebase Auth. Auth no se pierde con Firestore, así que
     una baja posterior a la copia nunca resucita datos personales (FR-020).
4. **Verifica**: ejecuta `ops smoke` y comprueba los saldos de un par de viajes conocidos.

El simulacro completo (copiar, vaciar, restaurar, comparar documento a documento y los saldos, y reaplicar una baja)
se ejecuta en CI: `apps/ops/tests/restore.test.ts`.

## Límites de los planes gratuitos y consumo estimado

Estimación para el piloto: 20 usuarios activos, 10 viajes activos y unos 5.000 documentos.

| Recurso | Límite gratuito | Uso estimado/día | % | Aviso al llegar a |
|---|---|---|---|---|
| Firestore lecturas | 50.000/día | ~8.000 app + ~5.000 backup + ~100 health | 26 % | 35.000 |
| Firestore escrituras | 20.000/día | ~1.500 | 8 % | 14.000 |
| Firestore borrados | 20.000/día | < 500 | 3 % | 14.000 |
| Firestore almacenamiento | 1 GiB | ~50 MB | 5 % | 700 MB |
| Workers peticiones | 100.000/día | ~10.000 | 10 % | 70.000 |
| Workers CPU | 10 ms/petición | < 5 ms (`pnpm --filter api perf`) | — | — |
| B2 almacenamiento | 10 GB | comprobantes ~1 GB + backups 11 × ~5 MB | 11 % | 7 GB |
| B2 descargas | 1 GB/día (gratis) | < 100 MB | < 10 % | 700 MB |
| OpenAI | crédito prepagado (límite de gasto en *Limits*) | ≤ 100 escaneos/día (cuota global de la app), ≈ 1–2 céntimos de USD por factura con `gpt-4.1-mini` | — | 80 % del límite de gasto |
| GitHub Actions | ilimitado (repo público) | 96 uptime + 1 backup | — | — |

Cada usuario activo añade unas 400 lecturas y 75 escrituras al día. Con todo en < 50 % del límite, el piloto cabe
holgadamente (SC-010).

### Si se acerca un límite

- **Lecturas de Firestore**:
  - Bajar el backup a días alternos: cron `30 3 */2 * *`. La pérdida máxima pasa a ser de 48 h.
  - Revisar pantallas con listeners abiertos.
- **Escrituras de Firestore**: revisar los reintentos de la cola offline en los logs (`route` /expenses con 409).
- **Peticiones del Worker**: revisar `RATE_LIMITED` en Observability. Puede ser un cliente en bucle.
- **B2**: los comprobantes caducan a los 6 meses. Comprobar que el cron horario ejecuta la retención.
- **Cuota agotada**:
  - La app muestra «Servicio temporalmente no disponible» y conserva lo que el usuario estaba haciendo.
  - Firestore restablece la cuota a medianoche, hora del Pacífico.
  - Los gastos offline pendientes se reintentan solos.
