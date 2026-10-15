# Data Model: Ranking de deudores (feature 007)

## Persistido

### Trip (`trips/{tripId}`) — campo nuevo

| Campo | Tipo | Regla |
|---|---|---|
| `spicyMode` | `boolean`, opcional | Ausente o `false` = apagado (FR-001). Solo lo cambia creador/administrador por la API (FR-002). |

- Cambiarlo sube `version` y `updatedAt` como cualquier `trip.update`.
- Auditoría: evento `trip.update` con `diff: { spicyMode }` (FR-004). Sin PII nueva.
- Sin migración ni índice nuevo. Las Firestore Rules no cambian (el cliente ya puede leer el viaje y no escribe).

## Derivado (no se guarda)

### RoastEntry (salida de `roastRanking`)

| Campo | Tipo | Descripción |
|---|---|---|
| `uid` | `Uid` | Miembro. |
| `netMinor` | `number` (entero) | Saldo neto (igual al de `BalancesResponse`). |
| `debtMinor` | `number` (entero ≥ 0) | `max(0, -netMinor)`. |
| `tier` | `'top' \| 'golfa' \| 'senorita' \| 'macho'` | Etiqueta según R5 de research. |
| `owes` | `{ toUid, amountMinor }[]` | Relaciones «zorra de» en la vista activa, mayor importe primero. |
| `mainOwnerUid` | `Uid \| null` | Dueño principal (primer elemento de `owes`), `null` si no debe a nadie en la vista. |

Invariantes (probadas con fast-check):

- Cada miembro de `netByMember` aparece exactamente una vez.
- Hay como máximo un `top`; si existe algún `netMinor < 0`, hay exactamente uno.
- `macho` ⇔ `netMinor >= 0`.
- Si se pasan las transfers de una vista que preserva saldos: `Σ owes(uid) − Σ lo que le deben (uid) = −netMinor`.
- Determinismo: misma entrada (en cualquier orden) → misma salida.

### Etiquetas y frases (web, `roastCopy.ts`)

| tier | Etiqueta | Frase |
|---|---|---|
| `top` | La más zorra del grupo | «{nombre} es la más zorra del grupo: le debe {importe} a {dueño}.» |
| `golfa` | Golfa barata | «{nombre} es una golfa barata: le debe {importe} a {dueño}.» |
| `senorita` | Señorita | «{nombre} es una señorita: solo le debe {importe} a {dueño}.» |
| `macho` | Macho caporal | «{nombre} es macho caporal: no le debe nada a nadie.» |

`{importe}` = `debtMinor` formateado en la moneda del viaje; `{dueño}` = nombre de `mainOwnerUid`.
