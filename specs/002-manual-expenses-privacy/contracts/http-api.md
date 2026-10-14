# Contrato HTTP API v1 — cambios de la feature 002

Base y convenciones: `specs/001-finance-engine-trips/contracts/http-api.md` (auth, errores,
versionado, idempotencia). Aquí solo lo nuevo o modificado.

## Códigos de error nuevos

| ErrorCode | HTTP | Cuándo |
|---|---|---|
| POSSIBLE_DUPLICATE | 409 | mismo `transactionDate` + `totalMinor` + algún pagador en común con un gasto vigente, sin `confirmDuplicate` |
| CATEGORY_INACTIVE | 409 | `categoryId` inexistente o desactivada al crear el gasto |
| DUPLICATE_CATEGORY | 409 | nombre de categoría repetido en el viaje |

## `POST /trips/{tripId}/expenses` (modificado)

Cuerpo = cuerpo de 001 más:

| Campo | Tipo | Notas |
|---|---|---|
| categoryId | string | requerido |
| notes | string? | ≤ 500 |
| servicePeriod | `{ startDate, endDate }`? | RF-23 |
| confirmDuplicate | boolean? | `true` tras el aviso |

Orden en la transacción: auth → membresía → estado → **idempotencia (replay)** → categoría →
motor → **duplicados** → commit (gasto, trip, ledger, `projections/public`,
`projections/categories`, `memberStats/*` de los involucrados, idempotencia, auditoría).

Respuesta 201: `{ expense: { id, seq, totalMinor, status, version, chargesByMember }, trip }`.

Respuesta 409 `POSSIBLE_DUPLICATE`:
```json
{ "error": { "code": "POSSIBLE_DUPLICATE", "message": "...",
  "details": { "similar": { "id": "e1", "description": "Cena", "transactionDate": "2026-11-01", "totalMinor": 4500 } } } }
```
`details.similar` solo se incluye si el usuario puede ver ese gasto; si no, `details: {}`.

## `POST /trips/{tripId}/expenses/{expenseId}/void` (sin cambios de contrato)

Ahora también descuenta `projections/public`, `projections/categories` y `memberStats/*`.

## `GET /trips/{tripId}/expenses/{expenseId}/history` (nuevo)

Quién: `canViewExpense`. Si no → 404. Respuesta:
`{ events: [{ action: "expense.create" | "expense.void", actorUid, timestamp, afterVersion }] }`.

## `GET /trips/{tripId}/stats` (nuevo)

Quién: miembro aceptado. Respuesta:
```json
{ "currency": "USD", "sharedTotalMinor": 0, "expenseCount": 0,
  "me": { "contributedMinor": 0, "sharedConsumedMinor": 0, "personalConsumedMinor": 0, "globalConsumedMinor": 0 },
  "byCategory": { "default-food": 0 },
  "members": [ { "uid": "...", "contributedMinor": 0, "sharedConsumedMinor": 0 } ] }
```
`byCategory`: trip completo para creador/admin; gastos visibles del usuario para el resto (Q3).
`members`: solo para creador/admin (FR-026); para el resto se omite.

## Categorías (nuevo)

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips/{tripId}/categories` | creador, admin | `{ name, color }` → `201 { category }` |
| `PATCH /trips/{tripId}/categories/{categoryId}` | creador, admin | `{ expectedVersion, name?, color?, active? }` → `200 { category }` |

Viaje cerrado/archivado → `TRIP_READ_ONLY`. Participante normal → `FORBIDDEN`.
