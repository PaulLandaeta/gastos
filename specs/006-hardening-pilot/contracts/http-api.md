# HTTP API — Fase 6

Base: `/v1`. Autenticación como en 001: `Authorization: Bearer <Firebase ID token>`. Errores `{ error: { code, message, details? } }`.

## Errores nuevos (`packages/contracts/src/errors.ts`)

| Código | HTTP | Cuándo |
|---|---|---|
| `ACCOUNT_DELETION_BLOCKED` | 409 | Hay pagos pendientes. `details.pendingSettlements: [{tripId, settlementId}]`. |
| `REAUTH_REQUIRED` | 401 | La baja necesita un inicio de sesión de hace ≤ 5 min. |
| `ACCOUNT_DELETED` | 403 | Token válido de una cuenta ya dada de baja: `me/sync`, crear viaje, aceptar invitación. |
| `RATE_LIMITED` | 429 | Se superó el límite. Cabecera `Retry-After: 60`, `details.retryAfter`. |
| `SERVICE_UNAVAILABLE` | 503 | La cuota del proveedor se agotó (`RESOURCE_EXHAUSTED`). `details.retryAfter`. |

## `GET /v1/me/deletion-preview`

Respuesta 200:

```json
{
  "trips": [
    {
      "tripId": "abc",
      "name": "Uyuni",
      "currency": "BOB",
      "status": "active",
      "role": "creator",
      "balanceMinor": -1500,
      "successor": { "uid": "uid-ana", "displayName": "Ana" },
      "pendingSettlements": [{ "settlementId": "s1", "direction": "outgoing", "amountMinor": 500 }]
    }
  ],
  "attachmentsToDelete": 2,
  "blocked": true
}
```

- `successor` solo aparece si `role === "creator"` y hay otros aceptados.
- `blocked` es `true` si algún viaje tiene `pendingSettlements`.

## `POST /v1/me/deletion`

Body: `{ "confirm": "BORRAR" }` (literal).

Validaciones, en orden:
1. Si el body no es válido, responde `VALIDATION_FAILED`.
2. Si `now − auth_time > 300 s`, responde `REAUTH_REQUIRED`.
3. Si hay pagos pendientes, responde `ACCOUNT_DELETION_BLOCKED`. No se aplica si ya hay una baja `in_progress`
   (reanudar).

Respuestas:
- 200: `{ "status": "completed" | "in_progress", "tripsProcessed": n }`.
- `in_progress`: queda trabajo pendiente y el cron lo terminará. El cliente puede reintentar.

Es idempotente: repetir la llamada continúa la baja o devuelve `completed`.

## Cambios en pagos

`POST /v1/trips/:tripId/settlements`:

- Body: `{ toUid, amountMinor, note?, fromUid? }`.
- `fromUid` distinto del actor exige que el actor sea `creator` o `admin`, y que `fromUid` sea un miembro eliminado. Si
  no, responde `FORBIDDEN`.
- `toUid` puede ser un miembro eliminado.

`POST /v1/trips/:tripId/settlements/:id/{confirm|reject}`: si el receptor está eliminado, también pueden resolver
`creator` y `admin`.

`POST /v1/trips/:tripId/settlements/:id/cancel`: si el emisor está eliminado, también pueden cancelar `creator` y
`admin`.

`Member` en las respuestas incluye `deletedAt: string | null`.

## `GET /v1/health` (público)

- **Respuesta normal**: `{ "ok": true, "version": "<sha>|dev", "environment": "production" }`.
- **Con `?deep=1`**: añade `"firestore": "ok" | "error"`, con 1 lectura de `ops/health`.
  - Si Firestore falla, responde 503 con `ok: false`.
- **Límite**: 60 peticiones por minuto por IP.

## Cabeceras

Todas las respuestas llevan `x-correlation-id`, `X-Content-Type-Options: nosniff` y, por defecto,
`Cache-Control: no-store`.
