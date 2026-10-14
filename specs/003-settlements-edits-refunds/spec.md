# Feature Specification: Liquidaciones, edición, restauración y devoluciones (Fase 3)

**Feature Branch**: `003-settlements-edits-refunds`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Fase 3 del PRD: liquidaciones y cambios. Construye sobre 001 y 002. Incluye: (a) liquidaciones/pagos (RF-09, RF-21, HU-08) con confirmación/rechazo del receptor; solo confirmados alteran saldos; inmutables; lista por estado; escenario «Pago pendiente no afecta balances»; (b) edición de gastos (RF-10, HU-10, RF-36) con control de versiones y diferencias visibles; escenario «Conflicto de edición concurrente»; historial redactado; visibilidad recalculada; (c) previsualización de impacto (RF-28) al editar/anular/restaurar con pagos confirmados; (d) restaurar gastos anulados (RF-29); (e) devoluciones por ítem (RF-37, HU-11) como movimiento compensatorio sin exceder lo reembolsable; (f) la vista simplificada puede iniciar un pago prellenado. Fuera de alcance: adjuntos/comprobantes (Fase 4), IA, offline, exportaciones, notificaciones (Fase 5), pagos bancarios."

## Clarifications

### Session 2026-10-13

- Q: ¿Cómo se corrige un pago confirmado por error? → A: No se revierte; se registra un pago en sentido contrario que la otra persona confirma.
- Q: ¿La devolución incluye la parte proporcional de impuestos/propinas/descuentos generales? → A: Por defecto sí (importe proporcional sugerido), editable por el usuario hasta el máximo reembolsable.
- Q: ¿Quién puede registrar una devolución? → A: Pagadores y beneficiarios del gasto, además de autor, creador y administradores.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar y confirmar un pago entre participantes (Priority: P1)

Como participante que debe dinero, quiero registrar que pagué (total o parcialmente) a otra
persona, y que ella lo confirme o rechace, para que los saldos reflejen solo lo que realmente se
recibió.

**Why this priority**: cerrar deudas es el objetivo final del producto (RF-09, RF-21); hoy los
saldos solo crecen.

**Independent Test**: Ana debe USD 20.00 a Pedro; Ana registra un pago de USD 10.00; mientras está
pendiente Ana sigue debiendo USD 20.00; cuando Pedro confirma, Ana debe USD 10.00.

**Acceptance Scenarios**:

1. **Given** Ana debe USD 20.00 a Pedro, **When** Ana registra un pago de USD 10.00 a Pedro,
   **Then** el pago queda «pendiente» y Ana sigue debiendo USD 20.00 (escenario PRD).
2. **Given** ese pago pendiente, **When** Pedro lo confirma, **Then** Ana debe USD 10.00 en ambas
   vistas de deudas y el pago queda «confirmado» e inmutable.
3. **Given** un pago pendiente, **When** Pedro lo rechaza indicando un motivo opcional, **Then**
   queda «rechazado», los saldos no cambian y Ana ve el motivo.
4. **Given** un pago pendiente, **When** alguien distinto del receptor intenta confirmarlo o
   rechazarlo, **Then** la acción es rechazada.
5. **Given** la vista simplificada propone «Juan → Ana USD 15.00», **When** Juan pulsa «Pagar»,
   **Then** se abre el registro de pago prellenado con receptor e importe, editable.
6. **Given** la lista de pagos del viaje, **When** se abre, **Then** se ven los pagos pendientes,
   confirmados y rechazados con emisor, receptor, importe, fecha y estado.

---

### User Story 2 - Editar un gasto con control de conflictos (Priority: P1)

Como autor, creador o administrador, quiero corregir un gasto ya registrado con el mismo
formulario con el que lo creé, sin pisar cambios que otra persona haya hecho a la vez.

**Why this priority**: hoy la única corrección posible es anular y volver a crear; editar es la
corrección natural (RF-10) y el PRD exige el escenario de conflicto (RF-36).

**Independent Test**: dos personas abren el mismo gasto en versión 4 y guardan cambios distintos;
una obtiene la versión 5 y la otra recibe un aviso de conflicto con las diferencias.

**Acceptance Scenarios**:

1. **Given** un gasto vigente en un viaje activo, **When** su autor lo edita y guarda, **Then** los
   cambios se aplican, la versión aumenta en 1 y los saldos se recalculan al instante.
2. **Given** un gasto en versión 4, **When** dos usuarios editan con versión esperada 4, **Then**
   una edición confirma la versión 5 y la otra recibe un conflicto y puede revisar las diferencias
   entre lo que intentó guardar y la versión actual (escenario PRD).
3. **Given** un participante que no es autor, creador ni administrador, **When** abre el gasto,
   **Then** no ve la acción «Editar» y una edición directa es rechazada.
4. **Given** una edición que cambia pagadores o beneficiarios, **When** se guarda, **Then** quienes
   dejan de estar involucrados pierden acceso al detalle y quienes se incorporan lo obtienen.
5. **Given** un gasto editado, **When** se abre su historial, **Then** aparece la edición con autor,
   fecha y un resumen de los campos cambiados, sin exponer datos de otros gastos.
6. **Given** un viaje cerrado o archivado o un gasto anulado, **When** se intenta editar, **Then**
   la acción no está disponible.

---

### User Story 3 - Previsualizar el impacto cuando ya hay pagos confirmados (Priority: P1)

Como autor o administrador, antes de editar, anular o restaurar un gasto en un viaje donde ya hay
pagos confirmados, quiero ver cómo cambian los saldos de cada persona y confirmar
explícitamente, para no deshacer liquidaciones sin darme cuenta.

**Why this priority**: RF-28 y PRD §5.4; evita sorpresas una vez que la gente ya se pagó.

**Independent Test**: con un pago confirmado en el viaje, anular un gasto muestra una tabla
«antes → después» por persona y solo se aplica tras confirmar.

**Acceptance Scenarios**:

1. **Given** un viaje con al menos un pago confirmado, **When** el autor guarda una edición que
   cambia saldos, **Then** se muestra la comparación de saldos por persona (antes, después,
   diferencia) y la edición solo se aplica tras confirmar.
2. **Given** el mismo viaje, **When** se anula o restaura un gasto, **Then** se muestra la misma
   comparación antes de aplicar.
3. **Given** un viaje sin pagos confirmados, **When** se edita, anula o restaura, **Then** no se
   exige la previsualización (se puede ver, pero no se obliga a confirmar).
4. **Given** una previsualización abierta, **When** otro cambio altera los saldos antes de
   confirmar, **Then** la confirmación se rechaza por conflicto y se ofrece recalcular.

---

### User Story 4 - Restaurar un gasto anulado (Priority: P2)

Como autor, creador o administrador, quiero restaurar un gasto anulado por error, viendo antes su
impacto, para que vuelva a contar en saldos y totales.

**Why this priority**: completa RF-29; la anulación existe desde la Fase 2.

**Independent Test**: anular y restaurar un gasto deja saldos, totales y estadísticas idénticos a
antes de anularlo; el historial muestra creación, anulación y restauración.

**Acceptance Scenarios**:

1. **Given** un gasto anulado en un viaje activo, **When** una persona autorizada lo restaura,
   **Then** vuelve a «vigente», cuenta otra vez en saldos y totales y el historial lo registra.
2. **Given** un gasto anulado cuya categoría ya no está activa, **When** se restaura, **Then** se
   restaura igualmente conservando su categoría.
3. **Given** un participante sin permiso, **When** intenta restaurar, **Then** la acción es
   rechazada.

---

### User Story 5 - Devoluciones por ítem (Priority: P2)

Como participante de un gasto, quiero registrar que un comercio devolvió total o parcialmente un
producto, indicando quién recibió el dinero, para que los saldos se corrijan sin alterar el gasto
original.

**Why this priority**: RF-37/HU-11; ocurre con menos frecuencia que pagos y ediciones.

**Independent Test**: de un ítem de 3 unidades por USD 30.00 compartido entre Ana y Pedro, se
devuelve 1 unidad (USD 10.00) que recibió Pedro; los cargos de Ana y Pedro bajan USD 5.00 cada uno
y Pedro pasa a deber al grupo los USD 10.00 recibidos; un segundo intento de devolver 3 unidades
es rechazado por exceder lo reembolsable.

**Acceptance Scenarios**:

1. **Given** un ítem con cantidad y beneficiarios, **When** se registra una devolución parcial
   indicando cantidad o importe y receptor, **Then** se crea un movimiento de devolución que
   ajusta los saldos y el gasto original no cambia.
2. **Given** devoluciones previas de un ítem, **When** una nueva devolución supera la cantidad o
   el importe aún reembolsable, **Then** es rechazada indicando el máximo disponible.
3. **Given** una devolución registrada, **When** se abre el detalle del gasto, **Then** se ven las
   devoluciones del ítem con importe, receptor, autor y fecha, y el neto del ítem tras
   devoluciones.
4. **Given** el receptor de la devolución, **When** no es participante del viaje, **Then** no se
   puede elegir (solo participantes).

---

### Edge Cases

- Pago a uno mismo o de importe cero: rechazado.
- Pago mayor que la deuda actual entre ambos: se permite con aviso «supera la deuda actual»; el
  excedente invierte la deuda.
- Pago pendiente cuando el viaje se cierra: no puede confirmarse ni rechazarse hasta reabrir
  (PRD §14.1, recomendación); sigue sin afectar saldos.
- Dos confirmaciones simultáneas del mismo pago: solo una tiene efecto.
- Edición que deja el gasto sin cuadrar: no se puede guardar (mismas reglas que el alta).
- Edición que cambia la moneda: imposible (moneda del viaje fija).
- Edición de un gasto con devoluciones: no puede reducir la cantidad o el importe de un ítem por
  debajo de lo ya devuelto, ni eliminar un ítem con devoluciones.
- Anular un gasto con devoluciones: las devoluciones dejan de contar junto con el gasto; al
  restaurarlo vuelven a contar.
- Restaurar un gasto con la misma fecha/total/pagador que otro vigente: se aplica el aviso de
  posible duplicado de la Fase 2.
- Un participante que deja de estar involucrado en un gasto tras una edición y tenía el detalle
  abierto: deja de verlo inmediatamente.
- La edición conserva el número de secuencia del gasto (y por tanto la rotación del redondeo).

## Requirements *(mandatory)*

### Functional Requirements

**Pagos (liquidaciones)**

- **FR-001**: Un participante MUST poder registrar un pago a otro participante del viaje con
  importe positivo en la moneda del viaje y nota opcional; el emisor es quien lo registra (RF-09).
- **FR-002**: Un pago nuevo MUST quedar «pendiente» y no alterar saldos; solo el receptor MUST
  poder confirmarlo o rechazarlo (motivo opcional) (RF-21).
- **FR-003**: Solo los pagos confirmados MUST alterar saldos, en ambas vistas de deudas; los
  confirmados son inmutables.
- **FR-004**: El emisor MUST poder cancelar su propio pago mientras esté pendiente.
- **FR-005**: La vista simplificada MUST ofrecer «Pagar» en cada transferencia propuesta del
  usuario, abriendo el registro de pago prellenado (editable); la propuesta no crea pagos por sí
  sola.
- **FR-006**: Todos los participantes MUST ver la lista de pagos del viaje (emisor, receptor,
  importe, fecha, estado y motivo de rechazo), filtrable por estado.
- **FR-007**: Con el viaje cerrado o archivado, MUST NOT poder registrarse, confirmarse,
  rechazarse ni cancelarse pagos.
- **FR-008**: Un pago confirmado MUST NOT revertirse: un error se corrige registrando un pago en
  sentido contrario (receptor → emisor) que la otra persona confirma; ambos quedan auditados.

**Edición de gastos**

- **FR-009**: Autor, creador y administradores MUST poder editar un gasto vigente de un viaje
  activo usando el mismo formulario y las mismas validaciones del alta (RF-10).
- **FR-010**: Cada edición MUST indicar la versión esperada; si la versión actual difiere, el
  sistema MUST rechazarla con conflicto y mostrar las diferencias entre la versión actual y el
  intento del usuario, sin perder lo que el usuario escribió (RF-36).
- **FR-011**: Una edición MUST conservar el número de secuencia del gasto, recalcular el reparto,
  los saldos y los totales, y recalcular quién puede ver el detalle (pagadores, beneficiarios y
  autor original).
- **FR-012**: Cada edición MUST registrarse en el historial con autor, fecha, versión y la lista de
  campos cambiados (sin importes por ítem de otras personas en el resumen).

**Previsualización de impacto**

- **FR-013**: Antes de aplicar una edición, anulación o restauración, el sistema MUST poder
  mostrar los saldos por persona antes y después del cambio y su diferencia (RF-28).
- **FR-014**: Si el viaje tiene al menos un pago confirmado, la confirmación explícita tras ver la
  previsualización MUST ser obligatoria; si los saldos cambiaron entre la previsualización y la
  confirmación, la operación MUST rechazarse con conflicto.

**Restauración**

- **FR-015**: Las mismas personas que pueden anular un gasto MUST poder restaurarlo en un viaje
  activo; vuelve a contar en saldos, totales, estadísticas y devoluciones asociadas, y queda en el
  historial (RF-29).

**Devoluciones**

- **FR-016**: Cada ítem MUST tener una cantidad (por defecto 1) que permita devoluciones parciales
  por cantidad; también MUST admitirse devolución por importe.
- **FR-017**: Una devolución MUST indicar ítem, cantidad o importe, y receptor del dinero (un
  participante del viaje); se registra como movimiento compensatorio auditable y no modifica el
  gasto original (RF-37).
- **FR-018**: La suma de devoluciones de un ítem MUST NOT superar su cantidad ni su neto
  reembolsable; el sistema MUST indicar el máximo disponible.
- **FR-019**: Una devolución MUST reducir el consumo de los beneficiarios del ítem en proporción a
  su asignación (redondeo determinista del motor) y registrar que el receptor recibió el dinero
  en nombre del grupo, de forma que la suma de saldos siga siendo cero.
- **FR-020**: El importe de una devolución MUST proponerse por defecto como el neto proporcional
  del ítem más su parte proporcional de los ajustes generales (impuestos, propinas, descuentos)
  calculada con el redondeo del motor, y el usuario MUST poder editarlo hasta el máximo
  reembolsable (lo que realmente devolvió el comercio).
- **FR-021**: Las devoluciones MUST poder registrarlas los pagadores y beneficiarios del gasto,
  además de su autor, el creador y los administradores.
- **FR-022**: Las devoluciones MUST ser visibles para quienes pueden ver el gasto y quedar
  reflejadas en el detalle del ítem.

**Transversales**

- **FR-023**: Todas las operaciones de esta fase MUST ser idempotentes ante reintentos y quedar en
  el historial del viaje con actor, fecha y versión.
- **FR-024**: Ninguna operación MUST revelar detalle de gastos a quien no puede verlos (RF-38):
  las devoluciones y previsualizaciones de un gasto solo son accesibles a quienes ven ese gasto.

### Key Entities

- **Pago**: emisor, receptor, importe, nota, estado (pendiente/confirmado/rechazado/cancelado),
  motivo de rechazo, fechas de registro y resolución, versión.
- **Devolución**: gasto, ítem, cantidad, importe, receptor, autor, fecha, estado (vigente o anulada
  con su gasto).
- **Versión de gasto**: número de versión, cambios respecto a la anterior (para historial y
  diferencias de conflicto).
- **Previsualización de impacto**: saldos por persona antes y después, diferencia y la versión de
  saldos sobre la que se calculó.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El escenario «Pago pendiente no afecta balances» se cumple de punta a punta en el
  100 % de las pruebas.
- **SC-002**: En el escenario de edición concurrente, exactamente una edición se aplica y la otra
  recibe conflicto con diferencias en el 100 % de las pruebas; nunca se pierde una edición en
  silencio.
- **SC-003**: Tras cualquier secuencia de altas, ediciones, anulaciones, restauraciones,
  devoluciones y pagos confirmados, la suma de saldos del viaje es exactamente cero y coincide con
  el recálculo completo en el 100 % de los casos.
- **SC-004**: El 100 % de las ediciones, anulaciones y restauraciones en viajes con pagos
  confirmados muestran la previsualización y exigen confirmación.
- **SC-005**: El 100 % de los intentos de devolver más de lo reembolsable son rechazados.
- **SC-006**: Un participante registra un pago desde la propuesta simplificada en menos de 20
  segundos; el receptor lo confirma en menos de 10 segundos desde que lo ve.
- **SC-007**: 0 accesos a devoluciones, historial o previsualización de gastos ajenos por
  participantes no involucrados.

## Assumptions

- Base: features 001 y 002 (motor, saldos, privacidad por gasto, proyecciones, formulario).
- Un pago es visible para todos los participantes (forma parte del grafo de deudas, RF-39).
- Pagos sobre viajes cerrados/archivados: bloqueados hasta reabrir (recomendación del PRD §14.1).
- La restauración usa los mismos permisos que la anulación (PRD §14.6: admins sí pueden).
- Comprobantes de pago y adjuntos se incorporan en la Fase 4.
- Notificaciones de pagos pendientes llegan en la Fase 5; mientras tanto, la lista de pagos
  pendientes se muestra destacada al receptor en el inicio del viaje.
- Cantidad de ítem: entero positivo; en el formulario por total, cantidad 1.
