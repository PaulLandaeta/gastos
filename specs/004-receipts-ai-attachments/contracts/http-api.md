# Contrato HTTP API v1 — cambios de la feature 004

Base: contratos de 001–003.

## Códigos de error nuevos

| ErrorCode | HTTP | Cuándo |
|---|---|---|
| AI_CONSENT_REQUIRED | 403 | escaneo sin consentimiento vigente |
| AI_QUOTA_EXCEEDED | 429 | cuota de viaje o global agotada (sin llamar al proveedor); `details: { scope, resetsAt }` |
| AI_UNAVAILABLE | 503 | el proveedor falló o expiró (la reserva de cuota se devuelve) |
| ATTACHMENT_INVALID | 422 | tipo, tamaño o páginas no permitidos, o el objeto subido no coincide con lo declarado |
| ATTACHMENT_DUPLICATE | 409 | misma huella ya adjunta al gasto o pendiente del usuario; `details: { existingId }` |

## Consentimiento

| Método y ruta | Cuerpo → Respuesta |
|---|---|
| `POST /me/ai-consent` | `{ version }` → `200 { aiConsent }` |
| `DELETE /me/ai-consent` | → `200 { aiConsent }` (revocado) |

## Subidas y adjuntos

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips/{t}/uploads` | miembro aceptado | `{ files: [{ fileName, mimeType, bytes, pages, sha256 }], target?: { expenseId } \| { settlementId } }` → `201 { uploads: [{ id, uploadUrl, headers, expiresAt }] }` |
| `POST /trips/{t}/expenses/{e}/attachments` | quien ve el gasto | `{ uploadIds }` → `201 { attachments }` |
| `DELETE /trips/{t}/expenses/{e}/attachments/{a}` | autor, creador, admin | → `200` (estado `removed`) |
| `GET /trips/{t}/expenses/{e}/attachments/{a}/url` | quien ve el gasto | → `{ url, expiresAt }` (15 min) |
| `GET /trips/{t}/expenses/{e}/attachments` | quien ve el gasto | → `{ attachments }` (incluye `deleted` para mostrar la retención) |
| `GET /trips/{t}/settlements/{s}/attachments` | emisor, receptor, gestores | → `{ attachments }` |
| `GET /trips/{t}/attachments/expiring` | miembro | → `{ attachments: [{ id, fileName, expiresAt, target, label }] }` solo de gastos/pagos visibles, vencen en ≤ 14 días |
| `POST /trips/{t}/settlements/{s}/attachments` | emisor | `{ uploadIds }` → `201 { attachments }` |
| `GET /trips/{t}/settlements/{s}/attachments/{a}/url` | emisor, receptor, gestores | → `{ url, expiresAt }` |

`POST /trips/{t}/expenses` (002) acepta además `attachmentUploadIds?: string[]` y `scanId?`.

## Escaneo

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips/{t}/scans` | miembro aceptado con consentimiento | header `Idempotency-Key`; `{ uploadIds }` → `200 { scanId, draft, warnings, quota: { tripRemainingToday } }` |

Orden: auth → membresía y viaje activo → consentimiento → idempotencia → validación de subidas
(propias, pendientes, ≤ 5 archivos, ≤ 10 páginas, ≤ 4 MB) → **reserva atómica de cuota** →
proveedor → normalización/validación → registro de métricas.

| `GET /trips/{t}/scans/quota` | miembro | → `{ tripRemainingToday, tripLimit, exhaustedScope, resetsAt }` |

## Administración

| Método y ruta | Quién | Respuesta |
|---|---|---|
| `GET /admin/ai-usage?from=YYYY-MM-DD&to=YYYY-MM-DD` | `ADMIN_UIDS` | `{ days: [{ date, requests, pages, bytes, failures, byProvider }], trips: [...], users: [...] }` |

## Local (solo `ENVIRONMENT=emulator`; 404 en cualquier otro entorno)

- `PUT|GET /local-blobs/{token}` — almacenamiento local firmado con HMAC (fuera de `/v1`: no lleva token de Firebase,
  igual que una URL firmada de B2).
- `POST /local-admin/run-retention?now=<ISO>` — ejecuta la retención con una fecha simulada.
