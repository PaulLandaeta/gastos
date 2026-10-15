# Research: Ranking de deudores en tono de broma (feature 007)

No quedaban `NEEDS CLARIFICATION` en el contexto técnico. Estas son las decisiones de diseño.

## R1. Dónde se calcula el ranking

- **Decision**: función pura `roastRanking` en `packages/finance-engine/src/roast.ts`, llamada desde la web con la
  respuesta que ya devuelve `GET /v1/trips/:tripId/balances` (`netByMember` + `transfers` de la vista pedida).
- **Rationale**:
  - La respuesta de saldos ya trae todo lo necesario y ya está autorizada para cualquier miembro (RF-38 se cumple
    por construcción, FR-015).
  - El motor ya define el orden canónico de desempate (`memberRanking`: `joinOrder` y luego uid), que FR-006 exige
    reutilizar.
  - El motor tiene `fast-check` y cobertura: las propiedades de SC-001/SC-002 se prueban ahí.
  - La web ya depende de `finance-engine`. Sin endpoint nuevo ni lecturas extra de Firestore.
- **Alternatives considered**:
  - Endpoint `GET /roast` en la API: duplica la lectura de saldos y añade una ruta sin necesidad.
  - Lógica en `apps/web/src/features/roast/roastModel.ts`: sin fast-check y con un desempate distinto del motor.

## R2. Textos de etiquetas y frases

- **Decision**: el motor devuelve un `tier` (`top`, `golfa`, `senorita`, `macho`); los textos fijos viven en
  `apps/web/src/features/roast/roastCopy.ts`.
- **Rationale**: el motor no conoce idioma ni nombres; la personalización futura (fuera de alcance) solo tocará la
  web y el ajuste del viaje.

## R3. Ajuste «modo picante»

- **Decision**: campo opcional `spicyMode: boolean` en el documento del viaje (ausente = `false`). Se cambia con el
  `PATCH /v1/trips/:tripId` existente añadiendo `spicyMode` a `UpdateTripBody`.
- **Rationale**:
  - El PATCH ya exige rol creador/administrador, `expectedVersion`, viaje mutable y escribe auditoría `trip.update`
    con el `diff` (FR-002, FR-004).
  - Al estar en el documento del viaje, la web lo recibe en tiempo real por el listener que ya existe (`useTrip`) y
    queda en la caché offline.
  - Sin migración: los viajes existentes no tienen el campo y quedan apagados (FR-001, SC-005).
- **Consecuencia aceptada**: cambiar el ajuste sube `trip.version`, igual que renombrar el viaje. En viajes
  archivados o cerrados no se puede cambiar (`assertMutable`), pero si estaba activado el ranking sigue visible.
- **Alternatives considered**: endpoint `POST /trips/:id/spicy-mode` (duplica autorización y auditoría); documento
  de ajustes aparte (más lecturas y reglas nuevas).

## R4. Datos de la vista directa y transitiva

- **Decision**: directa = `view=original`, transitiva = `view=simplified` del mismo endpoint, reutilizando la misma
  `queryKey` que `BalancesPanel` (`['balances', tripId, view, trip.version]`) para compartir caché.
- **Rationale**: la vista simplificada es exactamente la «transitividad» pedida (las cadenas A→B→C se convierten en
  A→C) y preserva el saldo neto (constitution I). FR-013 se cumple porque ambas vistas preservan `netByMember`.

## R5. Regla de etiquetas (precisión)

- `debt = -netMinor` para `netMinor < 0`. «La más zorra» = mayor `debt`, desempate por `memberRanking`.
- «Golfa barata» si `2 * debt > maxDebt` (entero, sin decimales: estrictamente más del 50 %). Igual a 50 % →
  «Señorita».
- `netMinor >= 0` → «Macho caporal».
- Dueño principal = acreedor con mayor importe en las `transfers` de la vista activa, desempate por `memberRanking`.
  Un «macho caporal» puede tener transfers como deudor en la vista directa (caso límite de la spec): se muestran sus
  relaciones, pero su etiqueta no cambia.
- Orden de la lista: deuda descendente, desempate `memberRanking`; después los «macho caporal» por `memberRanking`.

## R6. Consumo de cuota gratuita

- Cero escrituras nuevas salvo el cambio del ajuste (1 escritura de viaje + 1 de auditoría, raro).
- Lecturas: la vista transitiva comparte caché con el panel de saldos; la directa solo se pide si el usuario la
  activa. Impacto despreciable frente a los límites de Spark.

## R7. Alcance frente al PRD

- **Decision**: añadir **RF-57** al PRD («Ranking de deudores en tono de broma, opcional por viaje») como decisión
  del propietario del producto (2026-10-15).
- **Rationale**: la constitution (VIII) exige que todo lo implementado responda a un RF del PRD. No entra en ninguna
  exclusión de §2.
