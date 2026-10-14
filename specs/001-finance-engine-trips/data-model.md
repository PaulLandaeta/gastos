# Data Model: Motor financiero + identidad y viajes

**Feature**: `001-finance-engine-trips` · **Fecha**: 2026-10-13

Convenciones: importes `*Minor` = entero seguro (`Number.isSafeInteger`) en unidad menor;
porcentajes en puntos básicos (`bp`, 10000 = 100,00 %); fechas de calendario `YYYY-MM-DD`;
marcas de tiempo UTC ISO-8601; todo documento mutable lleva `version` (entero ≥ 1) y
`schemaVersion` (= 1). **Solo la API escribe**; la columna "Lectura cliente" resume las Rules.

## 1. Firestore

### `users/{uid}`

| Campo | Tipo | Reglas |
|---|---|---|
| uid | string | = id del documento (UID Firebase) |
| displayName | string | 1–100 |
| email | string | normalizado (trim + minúsculas) |
| emailVerified | boolean | del token |
| photoURL | string \| null | |
| createdAt, updatedAt | timestamp | |
| schemaVersion, version | int | |

Lectura cliente: solo el propio usuario.

### `users/{uid}/trips/{tripId}` (índice "mis viajes")

| Campo | Tipo | Reglas |
|---|---|---|
| tripId, name, startDate, endDate, currency | — | copia desnormalizada del viaje |
| status | enum TripStatus | |
| role | `creator` \| `admin` \| `member` | |
| updatedAt | timestamp | |

Lectura cliente: solo el propio usuario. Actualizado por la API en cada cambio de viaje/rol.

### `trips/{tripId}`

| Campo | Tipo | Reglas |
|---|---|---|
| name | string | 1–80, trim |
| startDate, endDate | date | `endDate >= startDate` |
| currency | string | código ISO 4217 del catálogo |
| status | `pending` \| `active` \| `closed` \| `archived` | ver §3 |
| previousStatus | TripStatus \| null | solo con `archived` |
| creatorUid | string | inmutable |
| participantsLocked, currencyLocked | boolean | `true` permanente tras primer gasto |
| firstExpenseAt | timestamp \| null | |
| expenseSeq | int ≥ 0 | último número de secuencia asignado |
| memberCount, pendingInvitationCount, declinedInvitationCount | int | contadores para transiciones |
| createdAt, updatedAt | timestamp | |
| schemaVersion, version | int | |

Lectura cliente: solo miembros aceptados (`members/{uid}` existe).

### `trips/{tripId}/members/{memberKey}`

`memberKey` = `uid` si está aceptado; mientras está invitado = `inv_{sha256(normalizedEmail)[0..16]}`;
al aceptar se crea `members/{uid}` y se borra la fila `inv_*` en la misma transacción.

| Campo | Tipo | Reglas |
|---|---|---|
| uid | string \| null | null mientras está invitado |
| email | string | normalizado |
| displayName | string \| null | |
| role | `creator` \| `admin` \| `member` | único `creator` por viaje |
| invitationStatus | `invited` \| `accepted` \| `declined` | creador nace `accepted` |
| invitedAt | timestamp \| null | |
| acceptedAt | timestamp \| null | creador = `createdAt` del viaje |
| joinOrder | int | posición estable: creador 0, luego orden de aceptación; desempate final `uid` |
| schemaVersion, version | int | |

Una fila `accepted` nunca se borra (FR-022); solo se eliminan filas `invited`/`declined`.

Lectura cliente: miembros aceptados del viaje ven todas las filas; los invitados no.

### `invitations/{normalizedEmail}/trips/{tripId}`

| Campo | Tipo |
|---|---|
| tripId, tripName, inviterDisplayName, startDate, endDate, currency | string |
| status | `invited` \| `declined` |
| createdAt, updatedAt | timestamp |
| schemaVersion, version | int |

Lectura cliente: `request.auth.token.email.lower() == normalizedEmail && email_verified`.
Se borra al aceptar o al retirar al invitado.

### `trips/{tripId}/expenses/{expenseId}`

Detalle completo del gasto. **No legible por el cliente en esta feature.**

| Campo | Tipo | Reglas |
|---|---|---|
| seq | int ≥ 1 | asignado en creación = `trip.expenseSeq + 1`, inmutable |
| description | string | 1–120 |
| transactionDate | date | sin validación de rango (RF-46) |
| currency | string | = `trip.currency` |
| totalMinor | int > 0 | = Σ `payers[].amountMinor` = Σ cargos netos |
| payers | `{ uid, amountMinor }[]` | ≥1, uids únicos, miembros aceptados, importes > 0 |
| splitMode | `total` \| `items` | |
| items | `ExpenseItem[]` | ver motor (§2); embebidos (≤ 200 ítems) |
| adjustments | `GeneralAdjustment[]` | descuento general, impuesto, propina |
| status | `active` \| `voided` | |
| ledgerEffect | `LedgerEffect` | resultado del motor guardado para restar al anular |
| createdBy | string | uid |
| idempotencyKey | string | UUID v4 |
| createdAt, updatedAt, voidedAt | timestamp | |
| schemaVersion, version | int | |

### `trips/{tripId}/projections/ledger`

| Campo | Tipo | Reglas |
|---|---|---|
| netByMember | `map<uid, int>` | Σ = 0 siempre |
| pairwise | `map<"debtorUid>creditorUid", int>` | bruto (sin compensar); la vista original compensa al leer |
| sourceRevision | int | = `trip.version` del último commit que lo modificó |
| schemaVersion, version | int | |

Reconstruible con `rebuildLedger`. No legible por el cliente (se sirve vía API).

### `trips/{tripId}/auditEvents/{eventId}`

`actorUid`, `action` (p. ej. `trip.create`, `member.invite`, `member.accept`, `member.role.set`,
`trip.status.close`, `expense.create`, `expense.void`), `entityType`, `entityId`,
`beforeVersion`, `afterVersion`, `timestamp`, `redactedDiff` (sin emails completos ni importes
por ítem), `correlationId`. Solo escritura API; sin lectura cliente en esta feature.

### `idempotencyKeys/{tripId}_{uid}_{key}`

`operation`, `resultRef`, `createdAt`, `expiresAt` (createdAt + 7 días). Sin lectura cliente.

## 2. Tipos del motor financiero (`packages/finance-engine`)

```text
Member            { uid, joinOrder }
Allocation        { mode: "equal" } 
                | { mode: "fixed",   shares: { uid, amountMinor }[] }
                | { mode: "percent", shares: { uid, bp }[] }          // Σ bp = 10000
ExpenseItem       { id, index, description, grossMinor, discountMinor ≥ 0,
                    classification: "shared" | "personal",
                    beneficiaries: uid[] (≥1; "personal" ⇒ exactamente 1),
                    allocation: Allocation }
GeneralAdjustment { kind: "discount" | "tax" | "tip", amountMinor > 0,
                    mode: "proportional" | "equal" | "manual",
                    manualShares?: { uid, amountMinor }[] }
ExpenseInput      { seq, totalMinor, payers, splitMode, items, adjustments, members }
                  // splitMode "total" ⇒ un único ítem sintético "shared" con todo el bruto
ExpenseResult     { chargesByMember: map<uid, { sharedMinor, personalMinor, netMinor }>,
                    ledgerEffect: LedgerEffect }
LedgerEffect      { netByMember: map<uid,int>, pairwise: map<"d>c", int> }
Payment           { fromUid, toUid, amountMinor, status: "pending"|"confirmed"|"rejected" }
DebtView          { transfers: { fromUid, toUid, amountMinor }[] }
EngineError       NOT_RECONCILED | INVALID_ALLOCATION | INVALID_PERCENT | ITEM_WITHOUT_BENEFICIARY
                | PAYER_NOT_MEMBER | DISCOUNT_EXCEEDS_ITEM | AMOUNT_NOT_SAFE_INTEGER
```

Funciones públicas: `computeExpense`, `paymentEffect`, `combineEffects`, `negateEffect`,
`rebuildLedger`, `originalDebts(ledger)`, `simplifiedDebts(netByMember, members)`,
`allocateLargestRemainder(totalMinor, weights, rotationOffset)`, `minorUnits(currency)`,
`isCurrency(code)` (tabla ISO 4217 propia del motor en `src/currencies.ts`; `contracts` la reexporta).

Validaciones clave: neto de ítem = `grossMinor − discountMinor` ≥ 0; Σ netos de ítems +
impuestos + propinas − descuentos generales = `totalMinor`; Σ aportes = `totalMinor`; todos los
importes y sumas intermedias enteros seguros (las cuotas racionales se calculan con `bigint`).

## 3. Máquina de estados del viaje

```text
                 (todos aceptan / sin invitados)
   pending ─────────────────────────────────────▶ active ◀──── reopen (creador|admin) ──┐
     │  ▲                                          │                                     │
     │  └── (nuevo invitado antes del 1er gasto) ──┘ close (creador|admin) ──▶ closed ───┘
     │                                             │                           │
     └── archive (creador) ──▶ archived ◀── archive (creador) ─────────────────┘
                                   │
                                   └── restore (creador) ──▶ previousStatus
```

- `active → pending` solo ocurre si el creador invita a alguien antes del primer gasto.
- `pending → active` es automática cuando `pendingInvitationCount == 0` y
  `declinedInvitationCount == 0`.
- En `closed` y `archived` toda mutación salvo la transición permitida devuelve `TRIP_READ_ONLY`.
- Gasto en `pending` → `TRIP_NOT_READY`.
- `participantsLocked`/`currencyLocked` pasan a `true` en la transacción del primer gasto y no
  vuelven a `false` (ni al anular).
