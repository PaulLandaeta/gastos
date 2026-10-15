# Implementation Plan: Ranking de deudores en tono de broma (modo picante)

**Branch**: `007-debt-roast-ranking` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-debt-roast-ranking/spec.md`

## Summary

Un ranking en tono de broma, opcional por viaje, que solo presenta datos que ya existen:

- **Motor**: función pura `roastRanking` en `finance-engine` que, a partir de `netByMember` y de las `transfers` de
  una vista, asigna la etiqueta (`top`, `golfa`, `senorita`, `macho`), calcula a quién debe cada uno y su dueño
  principal, con el desempate canónico `memberRanking`. Propiedades probadas con fast-check.
- **API**: `spicyMode` opcional en el viaje; se cambia con el `PATCH /v1/trips/:tripId` existente (rol creador o
  administrador, `expectedVersion`, auditoría `trip.update`). Sin rutas nuevas ni cambios en Rules.
- **Web**: tarjeta «Ranking del grupo» en el detalle del viaje, visible solo con `trip.spicyMode === true`, con el
  interruptor Directa/Transitiva. Reutiliza la consulta de saldos (`view=original|simplified`). Los gestores ven un
  interruptor «Modo picante».
- **PRD**: se añade RF-57 (decisión del propietario del producto) para cumplir el principio VIII.

## Technical Context

**Language/Version**: TypeScript 6 (web, API en Workers y paquetes).

**Primary Dependencies**: las existentes (React, TanStack Query, Hono, Zod, fast-check). Ninguna dependencia nueva.

**Storage**: Firestore, campo opcional `spicyMode` en `trips/{tripId}`. Sin migración ni índices.

**Testing**:
- **finance-engine (Vitest + fast-check)**: ejemplos de la spec (US1 escenarios 1–4, US2 1–3, casos límite) y
  propiedades: una etiqueta por miembro, como máximo un `top`, `macho ⇔ net ≥ 0`, umbral 50 % estricto,
  conservación del saldo neto con `originalDebts` y `simplifiedDebts`, determinismo ante permutaciones.
- **contracts**: `UpdateTripBody` acepta `spicyMode` y sigue rechazando un cuerpo vacío.
- **API (workerd + emulador)**: `PATCH` con `spicyMode` por creador, administrador (200, auditoría con
  `diff.spicyMode`), participante (403), viaje archivado (409 `TRIP_READ_ONLY`) y versión desfasada (409).
- **Web (Vitest)**: `roastCopy` (frases con importe y dueño; macho sin importe) y modelo de la tarjeta (nada si
  `spicyMode` es falso).
- **E2E (Playwright)**: activar como creador → el participante ve el ranking; cambiar vista; desactivar → desaparece;
  axe sin violaciones en la tarjeta.

**Target Platform**: igual que las fases anteriores (PWA en Chrome Android y Safari iOS).

**Project Type**: monorepo web (PWA) + API (Workers) + paquetes compartidos.

**Performance Goals**: SC-004, el ranking se pinta en < 1 s con 20 miembros. El cálculo es O(n log n + t) sobre
datos ya cargados.

**Constraints**:
- Sin escrituras nuevas salvo el cambio del ajuste.
- La vista transitiva comparte caché con `BalancesPanel`.
- Funciona offline con los saldos en caché (lectura); el ajuste solo se cambia con conexión.

**Scale/Scope**: hasta `MAX_TRIP_MEMBERS` miembros por viaje. 1 función de motor, 1 campo de contrato, 2 componentes
web.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | No escribe gastos, pagos ni saldos (FR-014). Usa enteros en unidad menor. Las propiedades prueban que las relaciones conservan el saldo neto en ambas vistas. | ✅ |
| II. Privacidad | Solo usa `GET /balances`, que ya ven todos los miembros. Sin datos de gastos privados (RF-38). Sin PII nueva en auditoría ni logs. | ✅ |
| III. Escrituras en servidor | El ajuste se cambia solo por la API con verificación de rol. El cliente no escribe en Firestore. | ✅ |
| IV. Auditable / versionado | Reutiliza `expectedVersion` y la auditoría `trip.update` del PATCH existente. | ✅ |
| V. Test-first | Primero las propiedades del motor y los tests de la API; después la UI y el E2E. | ✅ |
| VI. Free tier | Consumo despreciable (R6). Sin servicios nuevos. | ✅ |
| VII. PWA accesible | La etiqueta se comunica con texto (FR-018); interruptores con `aria-pressed`; axe en E2E; lectura offline. | ✅ |
| VIII. Simplicidad | Sin rutas, colecciones ni dependencias nuevas. La feature no estaba en el PRD: se añade **RF-57** como decisión del propietario del producto (R7). No toca ninguna exclusión de §2. | ✅ |

**Re-check post-diseño**: ✅.

## Project Structure

### Documentation (this feature)

```text
specs/007-debt-roast-ranking/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/http-api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
PRD_Gastos_de_Viaje_React_Firebase.md       # + RF-57
packages/finance-engine/
├── src/roast.ts                             # roastRanking (nuevo)
├── src/index.ts                             # exporta roastRanking y tipos
├── tests/unit/roast.test.ts                 # ejemplos de la spec (nuevo)
└── tests/property/roast.property.test.ts    # propiedades fast-check (nuevo)
packages/contracts/src/
├── domain.ts                                # Trip.spicyMode opcional
└── api/trips.ts                             # UpdateTripBody.spicyMode
apps/api/
├── src/services/trips.ts                    # updateTrip aplica spicyMode
└── tests/routes/trips.update.test.ts        # spicyMode: roles, auditoría, conflictos
apps/web/
├── src/features/roast/RoastPanel.tsx        # tarjeta del ranking (nuevo)
├── src/features/roast/SpicyModeToggle.tsx   # interruptor para gestores (nuevo)
├── src/features/roast/roastCopy.ts          # etiquetas y frases fijas (nuevo)
├── src/features/trips/TripDetailPage.tsx    # monta la tarjeta y el interruptor
├── tests/unit/roastCopy.test.ts             # (nuevo)
└── tests/e2e/roast.spec.ts                  # (nuevo)
```

**Structure Decision**: se mantiene el monorepo existente. La lógica determinista va al motor (donde están el orden
canónico y fast-check); los textos, a la web; el ajuste, al PATCH de viaje existente.

## Complexity Tracking

Sin violaciones que justificar.
