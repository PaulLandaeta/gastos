# Data Model: Gastos manuales, privacidad y dashboard

Extiende el modelo de `specs/001-finance-engine-trips/data-model.md`. Convenciones iguales:
importes enteros en unidad menor, `version` + `schemaVersion`, solo la API escribe.

## `trips/{tripId}/expenses/{expenseId}` — schemaVersion 2

Campos nuevos o cambiados respecto a 001:

| Campo | Tipo | Reglas |
|---|---|---|
| categoryId | string | categoría **activa** del viaje al crear (FR-012) |
| notes | string \| null | ≤ 500 caracteres |
| servicePeriod | `{ startDate, endDate }` \| null | fechas ISO, `endDate >= startDate` (FR-010, RF-23) |
| transactionDate | date | libre (RF-46) |
| recordedAt | timestamp | = `createdAt` (fecha de registro separada, FR-009) |
| payerUids | uid[] | únicos, derivados de `payers` (para duplicados y filtros) |
| beneficiaryUids | uid[] | unión de beneficiarios de todos los ítems |
| personalBeneficiaryUids | uid[] | beneficiarios de ítems `personal` (pestaña Personales) |
| viewerUids | uid[] | `payerUids ∪ beneficiaryUids ∪ {createdBy}`; inmutable; base de las Rules (FR-016) |
| sharedTotalMinor | int ≥ 0 | Σ `chargesByMember[*].sharedMinor` |
| personalTotalMinor | int ≥ 0 | Σ `chargesByMember[*].personalMinor`; `shared + personal = totalMinor` |
| chargesByMember | map uid → {sharedMinor, personalMinor, netMinor} | resultado del motor |
| duplicateConfirmed | boolean | `true` si se guardó tras el aviso de duplicado |

Se mantienen: `seq`, `description`, `currency`, `totalMinor`, `payers`, `splitMode`, `items`,
`adjustments`, `ledgerEffect`, `status`, `createdBy`, `idempotencyKey`, timestamps, `version`.

**Clasificación (FR-021)**: un gasto es *compartido* si `sharedTotalMinor > 0`, *personal* si
`personalTotalMinor > 0` (puede ser ambos: factura mixta). La lista «Compartidos» filtra
`sharedTotalMinor > 0`; «Personales» usa `personalBeneficiaryUids array-contains uid`.

Lectura cliente: miembro aceptado y (`uid ∈ viewerUids` o rol creador/admin vigente).

## `trips/{tripId}/categories/{categoryId}`

| Campo | Tipo | Reglas |
|---|---|---|
| name | string | 1–40, único en el viaje sin distinguir mayúsculas |
| color | string | `#RRGGBB` |
| isDefault | boolean | `true` para las 6 iniciales (`default-*`) |
| active | boolean | inactiva = no se ofrece para nuevos gastos; no se borra |
| createdBy | uid \| null | null en las iniciales |
| createdAt, updatedAt | timestamp | |
| schemaVersion, version | int | |

Iniciales: `default-lodging` Alojamiento · `default-transport` Transporte · `default-food` Comida ·
`default-activities` Actividades · `default-shopping` Compras · `default-other` Otros.
Lectura cliente: miembros aceptados.

## `trips/{tripId}/projections/public`

| Campo | Tipo |
|---|---|
| sharedTotalMinor | int — Σ `sharedTotalMinor` de gastos vigentes |
| expenseCount | int — gastos vigentes |
| schemaVersion, version | int |

Lectura cliente: ninguna; se sirve a todos los miembros vía `GET /stats` (único agregado global visible para todos, FR-023).

## `trips/{tripId}/projections/categories`

`byCategory: map categoryId → sharedMinor` (todo el viaje), `schemaVersion`, `version`.
Lectura cliente: ninguna; `GET /stats` lo devuelve solo a creador/admin (rol en vivo).

## `trips/{tripId}/memberStats/{uid}`

| Campo | Tipo | Significado |
|---|---|---|
| contributedMinor | int | Σ aportes como pagador (gastos vigentes) |
| sharedConsumedMinor | int | Σ `sharedMinor` propio |
| personalConsumedMinor | int | Σ `personalMinor` propio |
| globalConsumedMinor | int | shared + personal (RF-40) |
| visibleSharedByCategory | map categoryId → int | gasto compartido por categoría de los gastos que **este usuario** ve (Q3) |
| visibleExpenseCount | int | |
| schemaVersion, version | int | |

Actualización (crear: +, anular: −) en la transacción del gasto para cada `uid ∈ viewerUids`.
Lectura cliente: ninguna; `GET /stats` devuelve las propias y, a creador/admin, las de todos.

## Índices compuestos (`firebase/firestore.indexes.json`)

| Colección | Campos | Uso |
|---|---|---|
| expenses | viewerUids (array-contains), transactionDate desc, createdAt desc | lista de participante |
| expenses | transactionDate desc, createdAt desc | lista de admin (índice simple + orden) |
| expenses | viewerUids (array-contains), categoryId, transactionDate desc | filtro por categoría |
| expenses | categoryId, transactionDate desc | filtro por categoría (admin) |
| expenses | personalBeneficiaryUids (array-contains), transactionDate desc | pestaña Personales |
| expenses | status, transactionDate, totalMinor | detección de duplicados (API) |
| auditEvents | entityId, timestamp asc | historial del gasto (API) |

## Visibilidad (función compartida API ↔ Rules)

```text
canViewExpense(user, member, expense) =
  member.invitationStatus == 'accepted' &&
  (user.uid ∈ expense.viewerUids || member.role ∈ {creator, admin})

canVoidExpense(user, member, expense) =
  expense.status == 'active' && trip mutable &&
  (expense.createdBy == user.uid || member.role ∈ {creator, admin})
```
