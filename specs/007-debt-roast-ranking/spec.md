# Feature Specification: Ranking de deudores en tono de broma (modo picante)

**Feature Branch**: `007-debt-roast-ranking`

**Created**: 2026-10-15

**Status**: Draft

**Input**: User description: "Ranking de deudores en tono de broma (modo picante) para viajes de amigos. Solo
presentación, sin cambios en la contabilidad; usa los saldos netos y las deudas originales y simplificadas que ya ven
todos los miembros. (1) «X es la zorra de Y» = X le debe a Y; vista directa (deudas originales) y transitiva (deudas
simplificadas) con interruptor como RF-48; si X le debe a varios se destaca su «dueño principal». (2) Ranking por saldo
neto: «La más zorra del grupo», «Golfa barata» (> 50 % de la deuda de la más zorra), «Señorita» (el resto de
deudores), «Macho caporal» (saldo ≥ 0, puede haber varios); frase de burla con importe y acreedor; empates
deterministas. (3) Modo picante por viaje, lo activa el admin, apagado por defecto; apagado no se muestra nada.
(4) Nombres fijos en el MVP. Se actualiza con los saldos; anonimizados (RF-56) con su identidad anónima; viaje saldado
= todos macho caporal. Fuera de alcance: notificaciones, nombres personalizables, cambios en saldos o pagos."

Construye sobre: RF-48 (dos vistas de deudas, feature 003), RF-38 (privacidad, feature 002), RF-56 (anonimización,
feature 006), roles creador/administrador/participante (feature 001).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver el ranking del grupo (Priority: P1)

En el viaje de amigos el administrador ya activó el modo picante. Ana abre el viaje y ve el ranking: Beto es
«La más zorra del grupo» porque debe 120 €, Carla es «Golfa barata» con 70 €, Dani es «Señorita» con 15 € y Ana y Eva
son «Macho caporal» porque no deben nada. Cada etiqueta va con una frase de burla, por ejemplo «Beto es la más zorra
del grupo: le debe 120 € a Ana».

**Why this priority**: es el núcleo de la broma y lo que pidió el grupo; sin el ranking la feature no aporta nada.

**Independent Test**: en un viaje con modo picante activado y saldos conocidos, el ranking asigna cada etiqueta según
las reglas, muestra los importes exactos y la suma de lo que deben los deudores coincide con lo que se les debe a los
acreedores.

**Acceptance Scenarios**:

1. **Given** un viaje con modo picante y saldos Beto −120, Carla −70, Dani −15, Ana +150, Eva +55, **When** un miembro
   abre el ranking, **Then** Beto es «La más zorra del grupo», Carla «Golfa barata» (70 > 60), Dani «Señorita» y Ana y
   Eva «Macho caporal».
2. **Given** dos deudores con la misma deuda máxima, **When** se muestra el ranking, **Then** «La más zorra del grupo»
   es uno solo, elegido por el mismo criterio de desempate estable que ya usa la app (orden de incorporación al
   viaje), y el otro es «Golfa barata».
3. **Given** un deudor cuya deuda es exactamente el 50 % de la de «La más zorra», **When** se muestra el ranking,
   **Then** es «Señorita».
4. **Given** un viaje con todos los saldos en cero, **When** se abre el ranking, **Then** todos son «Macho caporal» y no
   hay «La más zorra del grupo».
5. **Given** se confirma un pago o se registra un gasto o una devolución que cambia los saldos, **When** un miembro
   vuelve a ver el ranking, **Then** las etiquetas reflejan los saldos nuevos.

---

### User Story 2 - Ver de quién es la zorra cada uno (Priority: P1)

Carla quiere saber a quién le debe. En el ranking, junto a su etiqueta, ve «Carla es la zorra de Ana (50 €) y de Eva
(20 €)», con Ana destacada como «su dueña principal». Con el interruptor cambia a la vista transitiva, donde las
cadenas se acortan: si Carla le debía a Beto y Beto a Ana, ahora aparece directamente como la zorra de Ana.

**Why this priority**: es la otra mitad de la broma («la zorra de quién») y la que usa la transitividad pedida.

**Independent Test**: con un viaje en el que A le debe a B y B le debe a C, la vista directa muestra A→B y B→C y la
vista transitiva muestra A→C; en ambas vistas el total que debe cada persona es su saldo neto.

**Acceptance Scenarios**:

1. **Given** A le debe 30 a B y B le debe 30 a C, **When** se ve la vista directa, **Then** «A es la zorra de B» y
   «B es la zorra de C».
2. **Given** el mismo viaje, **When** se cambia a la vista transitiva, **Then** «A es la zorra de C» y B no es la zorra
   de nadie.
3. **Given** X le debe a varias personas, **When** se muestra su relación, **Then** aparecen todos sus acreedores con
   el importe y se destaca como «dueño principal» al de mayor importe (empate: orden de incorporación al viaje).
4. **Given** las dos vistas, **When** se comparan, **Then** las etiquetas del ranking (User Story 1) son las mismas en
   ambas, porque dependen solo del saldo neto.

---

### User Story 3 - Activar o desactivar el modo picante (Priority: P2)

El administrador del viaje decide si el grupo quiere la broma. Por defecto está apagado; desde la configuración del
viaje lo activa y desde ese momento todos los miembros ven el ranking. Si alguien se queja, lo apaga y el ranking
desaparece para todos.

**Why this priority**: evita que la broma aparezca en viajes donde no hace gracia (por ejemplo, viajes de trabajo o
del piloto), pero el ranking (US1/US2) se puede probar activándolo a mano.

**Independent Test**: un viaje nuevo no muestra nada del ranking; tras activarlo el administrador, un participante lo
ve; tras desactivarlo, vuelve a no verse; un participante sin rol de administrador no puede cambiarlo.

**Acceptance Scenarios**:

1. **Given** un viaje recién creado, **When** cualquier miembro lo abre, **Then** no ve ninguna etiqueta, frase ni
   acceso al ranking.
2. **Given** el creador o un administrador del viaje, **When** activa el modo picante, **Then** todos los miembros ven
   el ranking la próxima vez que abren o refrescan el viaje.
3. **Given** un participante normal, **When** intenta cambiar el modo picante, **Then** no tiene la opción y el sistema
   rechaza el cambio si lo intenta por otra vía.
4. **Given** el modo picante activado, **When** el administrador lo desactiva, **Then** el ranking deja de mostrarse a
   todos.

---

### Edge Cases

- **Un solo deudor**: es «La más zorra del grupo»; no hay «Golfa barata» ni «Señorita».
- **Saldos de pocos céntimos** (residuos de redondeo): cualquier saldo negativo cuenta como deuda, aunque sea de una
  unidad menor; no hay umbral mínimo.
- **Persona con saldo neto ≥ 0 que aún figura como deudora en la vista directa** (le debe a uno pero otro le debe más
  a ella): su etiqueta es «Macho caporal» (depende del saldo neto) y en la vista directa se sigue mostrando a quién le
  debe; la vista transitiva no la muestra como deudora.
- **Participante eliminado (RF-56)**: aparece con su identidad anónima («Participante eliminado …») con la etiqueta que
  le corresponda, igual que en la vista de deudas.
- **Invitados pendientes o participantes sin movimientos**: solo aparecen los miembros que ya figuran en los saldos del
  viaje; con saldo cero son «Macho caporal».
- **Sin conexión**: el ranking se calcula con los mismos saldos que la app ya muestra sin conexión y lleva la misma
  indicación de datos desactualizados.
- **Viaje archivado o cerrado**: el ranking se sigue viendo (en modo lectura) si el modo picante estaba activado.

## Requirements *(mandatory)*

### Functional Requirements

**Modo picante**

- **FR-001**: Cada viaje MUST tener un ajuste «modo picante», desactivado por defecto en viajes nuevos y existentes.
- **FR-002**: Solo el creador y los administradores del viaje MUST poder activarlo o desactivarlo; el sistema MUST
  rechazar el cambio pedido por cualquier otro miembro.
- **FR-003**: Con el modo picante desactivado, el sistema MUST NOT mostrar ninguna etiqueta, frase, relación ni acceso al
  ranking a ningún miembro.
- **FR-004**: El cambio del ajuste MUST quedar en el historial de auditoría del viaje (quién y cuándo), sin datos
  personales más allá de los que el historial ya registra.

**Ranking (etiquetas por saldo neto)**

- **FR-005**: Con el modo picante activado, el sistema MUST asignar a cada miembro con saldo exactamente una etiqueta a
  partir de su saldo neto en el viaje:
  - «La más zorra del grupo»: el miembro con el saldo neto más negativo (uno solo).
  - «Golfa barata»: cualquier otro miembro con saldo negativo cuya deuda sea estrictamente mayor que el 50 % de la deuda
    de «La más zorra del grupo».
  - «Señorita»: cualquier otro miembro con saldo negativo.
  - «Macho caporal»: todo miembro con saldo neto mayor o igual que cero.
- **FR-006**: Los empates (para elegir a «La más zorra del grupo», al dueño principal y para ordenar la lista) MUST
  resolverse con el criterio estable que la app ya usa para las deudas: orden de incorporación al viaje y, después,
  identificador del miembro. El mismo conjunto de saldos MUST producir siempre el mismo ranking.
- **FR-007**: El ranking MUST mostrarse ordenado de mayor a menor deuda, con los «Macho caporal» al final.
- **FR-008**: Cada etiqueta MUST ir con una frase de burla que incluya el nombre del miembro, la etiqueta, el importe de
  su deuda en la moneda del viaje y, para los deudores, el nombre de su dueño principal en la vista activa; para los
  «Macho caporal», una frase sin importe de deuda.
- **FR-009**: Los nombres de las etiquetas y las frases MUST ser fijos (los definidos en esta especificación) e iguales
  para todos los viajes; personalizarlos queda fuera de alcance.

**Relación «X es la zorra de Y»**

- **FR-010**: Con el modo picante activado, el sistema MUST mostrar para cada deudor a quién le debe y cuánto, como
  «X es la zorra de Y (importe)».
- **FR-011**: El sistema MUST ofrecer un interruptor «Directa / Transitiva»:
  - Directa: las relaciones son las deudas de la vista original (RF-48).
  - Transitiva: las relaciones son las deudas de la vista simplificada (RF-48), donde las cadenas de deuda se acortan.
- **FR-012**: Si un deudor le debe a varios miembros, el sistema MUST destacar como «dueño principal» al de mayor
  importe en la vista activa.
- **FR-013**: En ambas vistas, la suma de lo que se muestra que debe cada miembro menos lo que se le debe MUST ser igual
  a su saldo neto, y las etiquetas del ranking MUST ser las mismas.

**Integridad y privacidad**

- **FR-014**: La feature MUST NOT crear, modificar ni borrar gastos, pagos, devoluciones ni saldos; es solo una forma de
  presentar datos ya existentes.
- **FR-015**: El ranking MUST usar únicamente los saldos netos y las deudas por pareja que todos los miembros del viaje
  ya pueden ver; MUST NOT revelar detalles de gastos que el miembro no puede ver (RF-38) ni mostrar nada a quien no es
  miembro del viaje.
- **FR-016**: Los miembros anonimizados (RF-56) MUST aparecer con su identidad anónima estable.
- **FR-017**: El ranking MUST reflejar los saldos vigentes: cualquier gasto, pago confirmado, devolución o eliminación
  que cambie los saldos MUST verse en el ranking igual que en la vista de deudas.
- **FR-018**: El ranking MUST cumplir los mismos criterios de accesibilidad que el resto de la app: la etiqueta se
  comunica con texto, no solo con color o emoji.

### Key Entities

- **Modo picante del viaje**: ajuste por viaje (activado/desactivado), con quién lo cambió por última vez y cuándo.
- **Entrada del ranking** (derivada, no se guarda): miembro, saldo neto, etiqueta, importe adeudado, dueño principal y
  frase de burla.
- **Relación de deuda** (derivada, no se guarda): deudor, acreedor e importe, según la vista directa o transitiva.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En el 100 % de los casos de prueba (incluidos empates, un solo deudor, todo saldado y residuos de
  céntimos) cada miembro recibe exactamente una etiqueta, hay como máximo una «La más zorra del grupo» y el resultado
  es idéntico al repetirlo con los mismos saldos.
- **SC-002**: En el 100 % de los casos de prueba, para cada miembro, lo que debe menos lo que se le debe en cada vista
  (directa y transitiva) es igual a su saldo neto, y los saldos del viaje son idénticos antes y después de ver o
  cambiar el modo picante.
- **SC-003**: Un miembro ve el ranking actualizado tras un cambio de saldos en el mismo tiempo en que ya se actualiza
  la vista de deudas.
- **SC-004**: El ranking aparece en menos de 1 segundo tras abrir el viaje en un móvil de gama media con 20 miembros.
- **SC-005**: El 0 % de los viajes nuevos o existentes muestra el ranking sin que un creador o administrador lo haya
  activado.
- **SC-006**: En una prueba con el grupo piloto, al menos 4 de cada 5 participantes entienden a quién le deben y cuánto
  solo con leer el ranking, sin explicación.

## Assumptions

- Los nombres de las etiquetas y el tono vulgar son deliberados y los pidió el grupo; el apagado por defecto y el
  control por administrador (FR-001/FR-002) son la salvaguarda para quien no quiera la broma.
- Frases de burla fijas del MVP (los nombres se insertan en tiempo de ejecución):
  - La más zorra del grupo: «{nombre} es la más zorra del grupo: le debe {importe} a {dueño}.»
  - Golfa barata: «{nombre} es una golfa barata: le debe {importe} a {dueño}.»
  - Señorita: «{nombre} es una señorita: solo le debe {importe} a {dueño}.»
  - Macho caporal: «{nombre} es macho caporal: no le debe nada a nadie.»
  Cuando el deudor le debe a varios, {importe} es su deuda total y {dueño} su dueño principal.
- Las etiquetas no cambian de género según la persona; son fijas, como en la petición.
- Un viaje tiene una sola moneda (el PRD excluye la conversión de divisas), así que los importes se comparan
  directamente.
- La vista transitiva usa exactamente la propuesta de deudas simplificadas que la app ya calcula; no se crea otro
  algoritmo.
- El ajuste se sincroniza como el resto de la configuración del viaje; sin conexión no se puede cambiar.
- Fuera de alcance: notificaciones sobre el ranking, nombres o frases personalizables, histórico del ranking, compartir
  el ranking fuera de la app y cualquier cambio en saldos o pagos.
