# Data Model: IA y adjuntos

Extiende 001–003. Solo la API escribe. Importes en unidad menor.

## `trips/{t}/uploads/{uploadId}` (nuevo) — subidas pendientes de vincular

| Campo | Tipo | Reglas |
|---|---|---|
| storageKey | string | `trips/{t}/uploads/{uploadId}/{nombre-saneado}` |
| fileName | string | ≤ 120 |
| mimeType | enum | `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `application/pdf` |
| bytes | int | 1 … 10 MB |
| pages | int | 1 (imagen) o 1…10 (PDF) |
| sha256 | string | hex 64, calculado en el navegador |
| uploadedBy | uid | |
| status | `pending` \| `linked` \| `deleted` | |
| createdAt, expiresAt | timestamp | `expiresAt = createdAt + 24 h` mientras `pending` |
| schemaVersion, version | int | |

Lectura cliente: solo `uploadedBy`.

## `trips/{t}/expenses/{e}/attachments/{a}` y `trips/{t}/settlements/{s}/attachments/{a}` (nuevo)

| Campo | Tipo | Reglas |
|---|---|---|
| storageKey, fileName, mimeType, bytes, pages, sha256 | — | copiados de la subida |
| uploadedBy, uploadedAt | uid, timestamp | |
| expiresAt | timestamp | `addCalendarMonths(uploadedAt, 6)` UTC |
| status | `active` \| `removed` \| `deleted` | `removed` = quitado por usuario; `deleted` = retención |
| deletedAt, deleteAttempts | timestamp \| null, int | |
| source | `manual` \| `scan` | |
| schemaVersion, version | int | |

Lectura cliente: gasto → misma visibilidad del gasto (como devoluciones); pago → emisor, receptor,
creador y admins.

## `trips/{t}/expenses/{e}` — campos nuevos

| Campo | Tipo |
|---|---|
| source | `manual` \| `ai` |
| scanId | string \| null |
| attachmentCount | int (activos) |

## `trips/{t}/scans/{scanId}` (nuevo)

| Campo | Tipo |
|---|---|
| requestedBy, uploadIds[], provider, model | — |
| status | `pending` \| `succeeded` \| `failed` \| `rejected_quota` |
| draft | `ReceiptDraft` normalizado (null si falla) |
| warnings | string[] |
| pages, bytes, latencyMs, errorCode | int / string |
| idempotencyKey, createdAt, completedAt | — |

Lectura cliente: solo `requestedBy` (el borrador también vuelve en la respuesta).

## Cuotas y métricas

- `aiUsage/global_{YYYY-MM-DD}`, `aiUsage/global_{YYYY-MM}`: `{ requests, pages, bytes, failures,
  byProvider: map, version }`.
- `trips/{t}/aiUsage/{YYYY-MM-DD}`: igual, ámbito viaje, `byUser: map`.
- Ninguno legible por el cliente; agregados vía `GET /v1/admin/ai-usage` (ADMIN_UIDS).

## `users/{uid}` — campo nuevo

`aiConsent: { version, acceptedAt, revokedAt } | null`.

## `ReceiptDraft` (contrato, `packages/contracts`)

```text
merchant?: { value, confidence }
transactionDate?: { value: YYYY-MM-DD, confidence }
detectedCurrency?: string
items: { description, quantity (int ≥ 1), unitPriceMinor?, totalMinor, confidence }[]
subtotalMinor?, taxMinor?, tipMinor?, discountMinor?, totalMinor? (con confianza)
warnings: ('CURRENCY_MISMATCH' | 'TOTAL_MISMATCH' | 'LOW_CONFIDENCE' | 'DATE_SUSPICIOUS' | 'DUPLICATE_PAGE' | 'EMPTY')[]
```

## Índices nuevos

- Grupo `attachments`: `status` + `expiresAt` (retención).
- Grupo `uploads`: `status` + `expiresAt` (limpieza).
