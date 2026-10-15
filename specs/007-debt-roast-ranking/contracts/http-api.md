# Contrato HTTP: feature 007

Solo cambia un endpoint existente. Ninguna ruta nueva.

## `PATCH /v1/trips/:tripId` — campo nuevo `spicyMode`

```jsonc
// Request (UpdateTripBody): al menos un campo además de expectedVersion
{ "expectedVersion": 7, "spicyMode": true }
```

| Caso | Respuesta |
|---|---|
| Creador o administrador, viaje `pending`/`active`, versión correcta | `200 { trip }` con `spicyMode: true` y `version` + 1; auditoría `trip.update` con `diff.spicyMode` |
| Participante normal | `403 FORBIDDEN` |
| Viaje archivado/cerrado | `409 TRIP_READ_ONLY` (comportamiento actual de `assertMutable`) |
| `expectedVersion` desfasada | `409 CONFLICT` |
| `spicyMode` no booleano | `400 VALIDATION_FAILED` |
| Solo `expectedVersion` | `400 VALIDATION_FAILED` ("Nothing to update") |

## `Trip` (contrato compartido)

- `spicyMode: z.boolean().optional()`; la web lo trata como `trip.spicyMode === true`.

## `GET /v1/trips/:tripId/balances?view=original|simplified` — sin cambios

La web lo usa como fuente del ranking: `netByMember` para las etiquetas y `transfers` para las relaciones.

## API pública del motor (`finance-engine`)

```ts
export type RoastTier = 'top' | 'golfa' | 'senorita' | 'macho';
export interface RoastEntry {
  uid: Uid; netMinor: number; debtMinor: number; tier: RoastTier;
  owes: { toUid: Uid; amountMinor: number }[]; mainOwnerUid: Uid | null;
}
export function roastRanking(
  netByMember: readonly { uid: Uid; netMinor: number }[],
  transfers: readonly Transfer[],
  members: readonly Member[],
): RoastEntry[];
```

- `members` define el desempate (`memberRanking`). Los uids de `netByMember` que falten en `members` se ordenan al
  final por uid (defensivo; no debería ocurrir).
- Lanza `EngineError('INVALID_ALLOCATION')` si un importe no es entero seguro.
