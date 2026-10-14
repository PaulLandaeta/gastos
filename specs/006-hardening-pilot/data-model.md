# Data Model: Hardening y piloto (Fase 6)

## Cambios en entidades existentes

### `trips/{tripId}/members/{uid}` (Member)

| Campo | Tipo | Cambio |
|---|---|---|
| `displayName` | string \| null | Al darse de baja → `"Participante eliminado N"`. |
| `email` | string | Al darse de baja → `""`. |
| `deletedAt` | Timestamp \| null | **Nuevo**. `null` = activo. |
| `deletedOrdinal` | int \| null | **Nuevo**. N estable y único dentro del viaje. |
| `role` | Role | Si era `creator` y hay otros aceptados → pasa a `member`; el sucesor pasa a `creator`. |

Reglas:
- **Invariante**: un miembro con `deletedAt != null` nunca recibe notificaciones ni puede ser «me» en una operación.
- **Validación**: un viaje tiene como máximo un `creator` activo.
- **Viaje sin otros aceptados**: el miembro conserva el rol `creator`, ya eliminado. Nadie más ve el viaje.

### `trips/{tripId}` (Trip)

| Campo | Tipo | Cambio |
|---|---|---|
| `deletedMemberCount` | int | **Nuevo**, empieza en 0. Sirve para numerar las etiquetas. |
| `version` | int | Se incrementa en cada anonimización (los clientes refrescan miembros). |

### `trips/{tripId}/settlements/{id}` (Settlement)

| Campo | Cambio |
|---|---|
| `createdBy` | **Nuevo** (uid del actor). Coincide con `fromUid`, salvo en un pago registrado por un gestor en nombre de un eliminado. |
| `resolvedBy` | Ya existía. En la resolución gestionada guarda el uid del gestor. |

## Entidades nuevas

### `accountDeletions/{uid}` (registro de bajas)

| Campo | Tipo | Notas |
|---|---|---|
| `uid` | string | Opaco. |
| `status` | `in_progress` \| `completed` | |
| `requestedAt` | Timestamp | |
| `completedAt` | Timestamp \| null | |
| `pendingTripIds` | string[] | Viajes aún por anonimizar. Se vacía conforme avanza. |
| `steps` | map<string, bool> | `trips`, `attachments`, `notifications`, `foreignNotifications`, `invitations`, `profile`, `auth`. |
| `formerNames` | string[] | Nombres que había que borrar de notificaciones ajenas. Se vacía al completar `foreignNotifications`. |
| `formerEmail` | string \| null | Necesario para borrar `invitations/{email}`. Se vacía al completar `invitations`. |
| `attempts` | int | Reintentos (cron). |
| `schemaVersion`, `version` | int | |

Reglas:
- Solo la API lee y escribe este registro (Rules: denegado).
- Al completarse no queda PII: `formerNames` vacío y `formerEmail` a `null`.

### Auditoría (acciones nuevas)

| Acción | entityType | diff |
|---|---|---|
| `member.deleted` | member | `{ ordinal }` |
| `member.creator_transferred` | member | `{ toOrdinalOrUid }` (uid opaco del sucesor) |
| `settlement.create` / `confirm` / `reject` / `cancel` | settlement | `+ { onBehalfOf: uid }` cuando lo hace un gestor |

### Copia de seguridad (bucket B2 `…-backups`)

```text
firestore/YYYY-MM-DD/backup.gvb       # gzip + AES-256-GCM: "GVB1" | iv(12) | tag(16) | ciphertext
firestore/YYYY-MM-DD/manifest.json    # { createdAt, kind: daily|weekly, docCount, collections: {id: n}, sha256, format: 1 }
```

- **Contenido**: NDJSON, con una línea por documento: `{"name": "trips/abc/expenses/x", "fields": {…REST Value…}}`.
- **Retención**: se conservan las 7 fechas más recientes y las de domingo (UTC) de los últimos 28 días; el resto se
  borra.

## Transiciones

```text
Usuario activo ──POST /me/deletion──► accountDeletions.in_progress ──(viajes, limpiezas, auth)──► completed
                      │                         ▲
                      └── fallo ────────────────┘ (reintento del usuario o cron horario)
```
