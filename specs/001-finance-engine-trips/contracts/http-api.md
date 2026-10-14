# Contrato HTTP API v1 (Cloudflare Worker)

> Ampliado por la feature 002: [`specs/002-manual-expenses-privacy/contracts/http-api.md`](../../002-manual-expenses-privacy/contracts/http-api.md)
> (gasto v2, categorías, historial, stats, duplicados).

Base: `https://api.<dominio>/v1` · JSON UTF-8 · Esquemas Zod en `packages/contracts/src/api/`.

## Convenciones

- **Auth**: `Authorization: Bearer <Firebase ID token>` obligatorio en todo endpoint. Sin token
  válido → `401 UNAUTHENTICATED`.
- **Identificadores en la ruta**: `tripId`/`expenseId` deben cumplir `[A-Za-z0-9_-]{1,128}`; si no, `404 NOT_FOUND`.
- **Correlación**: header de respuesta `x-correlation-id` (se acepta uno entrante si es UUID).
- **Versionado optimista**: toda mutación sobre un viaje existente envía `expectedVersion`
  (= `trip.version` leído). Distinto → `409 CONFLICT` con `{ currentVersion }`.
- **Idempotencia**: `POST` que crean recursos aceptan header `Idempotency-Key` (UUID v4);
  obligatorio en `POST /trips/{id}/expenses`. Repetir la clave devuelve la respuesta original.
- **Rate limiting**: fuera de alcance en esta feature (diferido a Fase 6, hardening).
- **Errores**: `{ "error": { "code": ErrorCode, "message": string, "details"?: object } }`.

| ErrorCode | HTTP | Cuándo |
|---|---|---|
| UNAUTHENTICATED | 401 | token ausente/inválido/expirado |
| EMAIL_NOT_VERIFIED | 403 | aceptar/rechazar sin email verificado |
| FORBIDDEN | 403 | rol insuficiente o no miembro (no revela existencia: viajes ajenos → 404) |
| NOT_FOUND | 404 | recurso inexistente o no visible |
| VALIDATION_FAILED | 422 | cuerpo inválido (detalles Zod por campo) |
| NOT_RECONCILED | 422 | aportes/cuotas/ajustes no suman el total |
| INVALID_ALLOCATION, INVALID_PERCENT, ITEM_WITHOUT_BENEFICIARY, PAYER_NOT_MEMBER, DISCOUNT_EXCEEDS_ITEM, AMOUNT_NOT_SAFE_INTEGER | 422 | errores del motor financiero (`packages/finance-engine`) |
| INTERNAL | 500 | error inesperado (detalle solo en logs, con `x-correlation-id`) |
| TRIP_NOT_READY | 409 | gasto con invitaciones pendientes/rechazadas |
| TRIP_READ_ONLY | 409 | mutación en `closed`/`archived` |
| PARTICIPANTS_LOCKED | 409 | invitar/retirar tras el primer gasto |
| CURRENCY_LOCKED | 409 | cambiar moneda tras el primer gasto |
| INVALID_TRANSITION | 409 | transición de estado no permitida |
| CONFLICT | 409 | `expectedVersion` desactualizado |
| DUPLICATE_INVITATION | 409 | correo ya invitado/miembro, o el propio creador |
| MEMBER_ALREADY_ACCEPTED | 409 | intento de retirar a un participante que ya aceptó |

## Endpoints

### Identidad

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /me/sync` | autenticado | — → `200 { user }` crea/actualiza `users/{uid}` desde el token |

### Viajes

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips` | autenticado | `{ name, startDate, endDate, currency, inviteEmails?: string[] }` → `201 { trip }` (estado `active` si no hay invitados, si no `pending`) |
| `GET /trips/{tripId}` | miembro aceptado | — → `200 { trip, members }` (ajenos → 404) |
| `PATCH /trips/{tripId}` | creador, admin | `{ expectedVersion, name?, startDate?, endDate?, currency? }` → `200 { trip }`; `currency` solo creador y solo si `!currencyLocked` |
| `POST /trips/{tripId}/status` | ver tabla | `{ expectedVersion, action: "close"\|"reopen"\|"archive"\|"restore" }` → `200 { trip }` |

Transiciones: `close`/`reopen` → creador o admin; `archive`/`restore` → solo creador.

### Invitaciones y miembros

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips/{tripId}/invitations` | creador | `{ expectedVersion, emails: string[] (1–20) }` → `201 { trip, members }` |
| `DELETE /trips/{tripId}/invitations/{memberKey}` | creador | `?expectedVersion=` → `200 { trip }` (solo filas `invited`/`declined`; fila `accepted` → `409 MEMBER_ALREADY_ACCEPTED`) |
| `POST /trips/{tripId}/invitations/accept` | invitado (email verificado coincide) | — → `200 { trip, member }` |
| `POST /trips/{tripId}/invitations/decline` | invitado (email verificado coincide) | — → `200 { }` |
| `PUT /trips/{tripId}/members/{uid}/role` | creador | `{ expectedVersion, role: "admin"\|"member" }` → `200 { member }`; sobre el creador → `403 FORBIDDEN` |

### Gastos (solo servicio, sin UI en esta feature)

| Método y ruta | Quién | Cuerpo → Respuesta |
|---|---|---|
| `POST /trips/{tripId}/expenses` | miembro aceptado | header `Idempotency-Key`; `ExpenseInput` sin `seq` ni `members` → `201 { expense: { id, seq, totalMinor, status }, trip }` |
| `POST /trips/{tripId}/expenses/{expenseId}/void` | autor, creador, admin | `{ expectedVersion }` (versión del gasto) → `200 { expense }` |

Orden de validación de `POST /expenses` (transacción): autenticación → membresía →
estado (`TRIP_READ_ONLY` / `TRIP_NOT_READY`) → idempotencia → esquema → motor
(`NOT_RECONCILED` …) → commit (gasto, proyección, `trip.expenseSeq`, locks, auditoría).

### Saldos

| Método y ruta | Quién | Respuesta |
|---|---|---|
| `GET /trips/{tripId}/balances?view=original\|simplified` | miembro aceptado | `200 { currency, netByMember: { uid, netMinor }[], transfers: { fromUid, toUid, amountMinor }[], sourceRevision }` |

Ambas vistas devuelven el mismo `netByMember`.

## Ejemplo: gasto mixto (spec US1, escenario 2)

```json
POST /v1/trips/t1/expenses
Idempotency-Key: 3f1c…
{
  "description": "Supermercado",
  "transactionDate": "2026-10-13",
  "totalMinor": 4200,
  "payers": [{ "uid": "pedro", "amountMinor": 4200 }],
  "splitMode": "items",
  "items": [
    { "id": "i1", "index": 0, "description": "Comida", "grossMinor": 3000, "discountMinor": 0,
      "classification": "shared", "beneficiaries": ["ana", "pedro"], "allocation": { "mode": "equal" } },
    { "id": "i2", "index": 1, "description": "Champú", "grossMinor": 1200, "discountMinor": 0,
      "classification": "personal", "beneficiaries": ["ana"], "allocation": { "mode": "equal" } }
  ],
  "adjustments": []
}
→ 201; balances: ana −2700, pedro +2700; original: ana→pedro 2700
```
