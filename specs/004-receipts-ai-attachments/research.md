# Research: IA y adjuntos (Fase 4)

**Feature**: `004-receipts-ai-attachments` · **Fecha**: 2026-10-13 · **Base**: 001–003.

## R1. Almacenamiento: `ReceiptStorageProvider`

- **Decision**: interfaz en `packages/contracts` con `presignPut(key, contentType, bytes)`,
  `presignGet(key, ttlSeconds)`, `head(key)`, `get(key)`, `delete(key)`. Adaptadores:
  - `B2StorageProvider` (producción): API S3 de Backblaze B2 con firma SigV4 (`aws4fetch`),
    bucket privado, URLs firmadas de PUT (subida directa desde el navegador, sin pasar por el Worker)
    y GET de 15 min. CORS del bucket limitado a `ALLOWED_ORIGINS`.
  - `LocalStorageProvider` (emulador/tests): binding R2 **local** de Miniflare (`env.emulator` en
    `wrangler.jsonc`); el Worker expone `PUT/GET /v1/local-blobs/{token}` firmados con HMAC. No se
    usa R2 en producción (requeriría tarjeta).
  - Alternativa documentada: `SupabaseStorageProvider` (misma interfaz) si B2 exigiera tarjeta.
- **Rationale**: la subida directa evita CPU y ancho de banda del Worker (límite 10 ms). Una sola
  interfaz permite cambiar de proveedor sin tocar la app (constitution VI).
- **Integridad y límites**: no hay garantía documentada de que B2 verifique `x-amz-checksum-sha256`
  en URLs firmadas → la huella SHA-256 la calcula el navegador (Web Crypto) y sirve para detectar
  duplicados (función de UX, no de seguridad). El tamaño y el tipo se verifican con `head()` al
  vincular o analizar; si no cumplen, el objeto se borra y la operación falla.

## R2. Flujo de subida y vinculación

1. `POST /trips/{t}/uploads` con metadatos (nombre, tipo, bytes, páginas, sha256) → valida tipo,
   tamaño, duplicados (contra adjuntos del gasto destino y las subidas pendientes del usuario) y
   devuelve una URL de subida por archivo. Crea `trips/{t}/uploads/{u}` (`status: pending`,
   `expiresAt = +24 h`).
2. El navegador sube con `PUT` directo; en fotos, antes comprime a JPEG de ≤ 1.600 px (canvas).
3. Vinculación: al crear un gasto (`attachmentUploadIds`), al adjuntar a uno existente
   (`POST …/expenses/{e}/attachments`) o a un pago (`POST …/settlements/{s}/attachments`), la API
   verifica con `head()`, mueve el registro a la subcolección del gasto/pago y fija
   `expiresAt = uploadedAt + 6 meses`.
4. Subidas no vinculadas en 24 h → borradas por el proceso programado (FR-023).

## R3. IA: `ReceiptAIProvider` y Gemini

- **Decision**: `extract({ files: { mimeType, bytes }[], currencyHint, locale }) → ReceiptDraft`
  (contrato del PRD §9, importes en unidad menor). `GeminiReceiptProvider` llama a
  `generateContent` con las imágenes/PDF como `inline_data` (base64 nativo de `nodejs_compat`, sin
  coste de CPU en JS), `responseMimeType: application/json` y un esquema de respuesta; la salida se
  valida con Zod y se normaliza (decimales de la moneda, cantidades, fechas). Modelo configurable
  (`GEMINI_MODEL`) porque los nombres de modelo del nivel gratuito cambian; la clave va en un
  secret (`GEMINI_API_KEY`).
- **Límite por análisis**: ≤ 5 archivos, ≤ 10 páginas, ≤ 4 MB en total tras compresión (inline
  admite hasta 50 MB en PDF, pero 4 MB mantiene la latencia y la CPU acotadas).
- **Pruebas**: `FakeReceiptProvider` determinista (emulador/tests) y tests del adaptador Gemini con
  `fetch` simulado (petición correcta, respuesta válida, respuesta inválida, 429/5xx).
- **Post-proceso** (puro, en `packages/contracts`): `normalizeDraft` + `draftWarnings` (moneda
  distinta, suma de ítems ≠ total, fecha futura/imposible, baja confianza < 0,7) y
  `draftToExpenseDraft` que el formulario de 002 ya sabe editar.
- **Rationale**: inline evita el protocolo de subida reanudable (no documentado en REST en lo
  consultado) y el estado temporal en el proveedor.

## R4. Consentimiento (Q1)

`users/{uid}.aiConsent = { version, acceptedAt, revokedAt }` vía `POST/DELETE /me/ai-consent`.
`POST /scans` exige consentimiento vigente de la versión actual; si no → `403 AI_CONSENT_REQUIRED`.

## R5. Cuotas atómicas (Q2, RF-51)

- **Decision**: documentos `aiUsage/global_{YYYY-MM-DD}`, `aiUsage/global_{YYYY-MM}`,
  `trips/{t}/aiUsage/{YYYY-MM-DD}`. Antes de llamar al proveedor, una transacción **reserva** una
  unidad en los tres contadores (falla con `429 AI_QUOTA_EXCEEDED` si alguno superaría su límite) y
  registra el análisis `pending` con su clave de idempotencia. Tras la llamada, se registran
  páginas, bytes, latencia y resultado; si el proveedor falla, la reserva se **devuelve** (un fallo
  del proveedor no consume cuota) y cuenta un reintento del archivo (máx. 2).
- Límites en variables (`AI_QUOTA_TRIP_DAY=20`, `AI_QUOTA_GLOBAL_DAY=100`,
  `AI_QUOTA_GLOBAL_MONTH=1500`), configurables por el administrador técnico sin despliegue de código.
- Métricas: `GET /v1/admin/ai-usage?from&to` solo para `ADMIN_UIDS`; agregados por día, viaje,
  usuario y proveedor; sin contenido de comprobantes.

## R6. Retención (RF-52/53, Q3)

- `expiresAt = addCalendarMonths(uploadedAt, 6)` en UTC, último día válido si el día no existe
  (función pura con tests de borde: 31-mar → 30-sep, 29-feb → 29-ago, 31-ago → 28/29-feb).
- **Cron Trigger** cada hora (1 de los 5 disponibles): procesa en lotes pequeños (≤ 25) las
  consultas de grupo `attachments where status == 'active' and expiresAt <= now` y
  `uploads where status == 'pending' and expiresAt <= now`; por cada uno: `delete()` del objeto
  (idempotente: «no existe» = éxito), marca `status: 'deleted'`, `deletedAt`, audit
  `attachment.expire`; los fallos quedan `deleteAttempts++` para la siguiente ejecución. CPU por
  ejecución acotada por el tamaño del lote (I/O no cuenta).
- Aviso (Q3): la UI muestra «se eliminará el …» cuando `expiresAt - now ≤ 14 días`; el inicio del
  viaje lista los comprobantes próximos a vencer **solo de gastos visibles** para el usuario.

## R7. Visibilidad

- Metadatos de adjuntos de gasto: `trips/{t}/expenses/{e}/attachments/{a}` (heredan visibilidad
  como las devoluciones). De pago: `trips/{t}/settlements/{s}/attachments/{a}`, legibles por emisor,
  receptor y gestores (regla con `get()` del pago). Subidas pendientes: solo su autor.
- Los enlaces de descarga solo los emite la API tras `canViewExpense`/permiso del pago; TTL 15 min.

## R8. Presupuesto free tier

| Operación | Firestore R/W | Workers | Otros |
|---|---|---|---|
| Subida (3 archivos) | 3 R / 3 W | 1 | 3 PUT directos a B2 |
| Escaneo | ~6 R / ~6 W | 1 | 1–5 GET a B2 + 1 llamada Gemini |
| Cron horario | ≤ 50 R/W por ejecución | 24/día | DELETE en B2 |

B2: 10 GB gratis; con fotos comprimidas (~300 KB) y retención de 6 meses el uso previsto es < 1 GB.
