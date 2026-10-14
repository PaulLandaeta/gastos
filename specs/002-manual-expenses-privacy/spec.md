# Feature Specification: Gastos manuales, privacidad y dashboard (Fase 2)

**Feature Branch**: `002-manual-expenses-privacy`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Fase 2 del PRD: gastos manuales y balances. Construye sobre la feature 001 (motor financiero, viajes, registro/anulación de gastos a nivel de servicio y saldos ya existen). Incluye: (a) UI mobile-first de registro manual con acceso rápido «Registro manual» (RF-25; «Escanear factura» visible pero deshabilitado hasta Fase 4): reparto por total y por ítems (RF-05), igual/fijo/porcentaje (RF-12), asignación masiva (RF-27), facturas mixtas (RF-42), descuentos, impuestos y propinas (RF-11, RF-45), varios pagadores (RF-07, RF-32), fecha libre (RF-46), servicios de varios días (RF-23), validación en vivo del total; (b) categorías por viaje (RF-14); (c) privacidad de detalle (RF-38, RF-39) en API y reglas de acceso; (d) gastos personales separados (RF-40, RF-41); (e) dashboard básico y filtros (RF-15); (f) lista y detalle de gasto según permisos con anulación desde la UI e historial (RF-29 solo anular, RF-10); (g) advertencia de posible duplicado (RF-22). Fuera de alcance: edición de gastos, restaurar anulados, devoluciones, liquidaciones, IA, adjuntos, offline, exportaciones, notificaciones."

## Clarifications

### Session 2026-10-13

- Q: ¿Qué ve un participante no involucrado de un gasto compartido ajeno en la lista? → A: Nada: no aparece en su lista; solo cuenta en los totales agregados y en los saldos.
- Q: En una factura mixta, ¿qué ve un beneficiario de los ítems personales de otros? → A: Detalle completo: quien puede ver el gasto ve todos sus ítems, incluidos los personales de otros con descripción y persona.
- Q: ¿Sobre qué gastos se calcula el gráfico por categoría para un participante normal? → A: El total compartido del viaje es visible para todos; el desglose por categoría y los filtros se calculan solo sobre los gastos visibles para el usuario (admin y creador ven todo).
- Q: ¿La categoría se asigna por gasto o por ítem? → A: Una categoría por gasto; todos sus ítems y ajustes cuentan en ella.
- Q: ¿Qué volumen de gastos por viaje debe soportarse? → A: Hasta 1.000 gastos por viaje (grupo previsto: 4 personas con ~2.000–3.000 de gasto cada una, del orden de cientos de registros); lista paginada de 50 en 50 y dashboard calculado sobre resúmenes ligeros de los gastos visibles. Los importes no tienen límite práctico (enteros seguros).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar un gasto compartido simple (Priority: P1)

Como participante de un viaje activo, quiero registrar en pocos pasos un gasto pagado por mí y
repartido en partes iguales entre las personas que elijo, para que los saldos se actualicen al
instante.

**Why this priority**: es el uso más frecuente del producto y el primer valor visible tras la
Fase 1 (hoy solo se pueden registrar gastos por servicio, sin interfaz).

**Independent Test**: desde el inicio del viaje, pulsar «Registro manual», introducir importe,
descripción, categoría y beneficiarios, guardar y ver el gasto en la lista y los saldos
actualizados.

**Acceptance Scenarios**:

1. **Given** un viaje activo en USD, **When** Ana pulsa «Registro manual», escribe USD 10.00,
   «Cena», categoría Comida, y elige a Ana, Pedro y Juan, **Then** el gasto se guarda, aparece en
   la lista y los saldos muestran Ana +6.66, Pedro −3.33, Juan −3.33.
2. **Given** el formulario de registro, **When** el usuario lo recorre, **Then** la moneda del
   viaje y el total se muestran en cada paso y no se ofrece elegir otra moneda.
3. **Given** un viaje pendiente, cerrado o archivado, **When** un participante abre el inicio del
   viaje, **Then** el botón «Registro manual» no está disponible y se explica el motivo.
4. **Given** el inicio de un viaje activo, **When** se muestra, **Then** aparecen los botones
   «Registro manual» (activo) y «Escanear factura» (visible pero deshabilitado, «Próximamente»).
5. **Given** un gasto con fecha anterior o posterior al rango del viaje, **When** se guarda,
   **Then** se acepta y se usa esa fecha en listas y filtros.

---

### User Story 2 - Factura por ítems, mixta y con ajustes (Priority: P1)

Como participante, quiero cargar una factura con varios productos, asignar cada uno a quien lo
consumió (en lote o individualmente), marcar productos personales, aplicar descuentos, impuestos
y propinas y registrar varios pagadores, para que cada persona pague exactamente lo suyo.

**Why this priority**: es la razón de ser del producto (RF-05, RF-12, RF-42) y su principal
diferencia frente a una hoja de cálculo.

**Independent Test**: registrar una factura de 4 ítems (uno personal), con descuento general,
impuesto proporcional, propina equitativa y dos pagadores; el formulario impide guardar hasta
que todo cuadra y, al guardar, los cargos por persona coinciden al centavo con el cálculo
esperado.

**Acceptance Scenarios**:

1. **Given** una factura con 4 ítems, **When** el usuario selecciona 3 ítems y les asigna
   «Ana, Pedro» en lote, **Then** los 3 ítems quedan con esos beneficiarios y luego puede ajustar
   uno a «importe fijo» sin afectar a los demás.
2. **Given** un ítem sin beneficiarios, **When** el usuario intenta guardar, **Then** el ítem se
   resalta como pendiente y el guardado está bloqueado.
3. **Given** ítems, ajustes y pagadores cuya suma no coincide con el total, **When** el usuario
   edita, **Then** ve en vivo la diferencia («faltan USD 1.50» / «sobran USD 0.20») y no puede
   guardar hasta que la diferencia sea cero.
4. **Given** porcentajes de un ítem que suman 99,99 %, **When** se intenta guardar, **Then** se
   indica que deben sumar exactamente 100,00 %.
5. **Given** una factura con un ítem personal de Ana pagado por Pedro, **When** se guarda,
   **Then** Ana debe ese importe a Pedro y el ítem cuenta como gasto personal de Ana, no como
   compartido.
6. **Given** dos pagadores, **When** los aportes no suman el total, **Then** no se puede guardar;
   solo aparecen como pagadores posibles los participantes del viaje.
7. **Given** un alquiler de coche de 3 días, **When** se registra con fechas de inicio y fin del
   servicio, **Then** queda como un único gasto, sin reparto diario.

---

### User Story 3 - Privacidad del detalle de gastos (Priority: P1)

Como participante, quiero que solo quienes pagaron o se beneficiaron de un gasto (y los
administradores) vean sus productos, importes por persona y pagadores, mientras todos ven los
saldos y quién debe a quién.

**Why this priority**: es el riesgo principal del PRD (§13.1) y requisito previo a mostrar
gastos en la interfaz.

**Independent Test**: con un gasto entre Ana y Pedro, Juan (participante no involucrado) no
puede obtener su detalle por ninguna vía (pantalla, enlace directo o consulta directa a los
datos) y sí ve los saldos de todos.

**Acceptance Scenarios**:

1. **Given** un gasto en el que Juan no es pagador ni beneficiario y Juan no es administrador,
   **When** Juan solicita los ítems del gasto por cualquier vía, **Then** el acceso es denegado y
   el gasto ni siquiera aparece en su lista; solo influye en los totales del viaje y en los saldos.
2. **Given** el mismo gasto, **When** lo consulta un administrador o el creador, **Then** ven el
   detalle completo.
3. **Given** cualquier participante, **When** consulta los saldos, **Then** ve el saldo neto de
   todos y las deudas entre personas (original y simplificada), sin productos ni descripciones de
   gastos ajenos.
4. **Given** un gasto personal de Ana pagado por ella misma, **When** Pedro (no admin) mira la
   lista o el dashboard, **Then** ese gasto no aparece en sus vistas ni en los totales
   compartidos.

---

### User Story 4 - Lista, detalle, anulación e historial (Priority: P2)

Como participante, quiero ver los gastos del viaje que me corresponden, abrir su detalle con el
reparto por persona, y —si soy autor, creador o admin— anular un gasto erróneo viendo su
historial de cambios.

**Why this priority**: necesario para corregir errores sin la edición (Fase 3).

**Independent Test**: anular un gasto desde su detalle con confirmación; desaparece de los
totales, queda marcado como anulado y su historial muestra quién lo creó y quién lo anuló.

**Acceptance Scenarios**:

1. **Given** la lista de gastos, **When** se abre, **Then** cada gasto visible muestra fecha,
   descripción, categoría, total y pagador(es), y los anulados aparecen marcados y excluidos de
   los totales.
2. **Given** el detalle de un gasto propio, **When** el autor pulsa «Anular» y confirma,
   **Then** el gasto pasa a anulado y los saldos se recalculan.
3. **Given** un participante que no es autor, creador ni admin, **When** abre el detalle,
   **Then** no ve la acción «Anular».
4. **Given** el detalle de un gasto, **When** se abre el historial, **Then** se listan los eventos
   (creación, anulación) con autor y fecha, sin datos de otros gastos.

---

### User Story 5 - Categorías del viaje (Priority: P2)

Como creador o administrador, quiero contar con categorías iniciales y crear o desactivar
categorías propias, para clasificar los gastos y filtrar por ellas.

**Why this priority**: alimenta el dashboard y los filtros; el registro funciona con las
iniciales.

**Independent Test**: un admin crea «Excursiones», se usa en un gasto y aparece en filtros y en
el gráfico; un participante normal no puede crear categorías.

**Acceptance Scenarios**:

1. **Given** un viaje nuevo, **When** se registra el primer gasto, **Then** están disponibles las
   categorías iniciales.
2. **Given** un creador o admin, **When** crea una categoría con nombre y color, **Then** queda
   disponible para todos los participantes.
3. **Given** un participante normal, **When** intenta crear o desactivar categorías, **Then** la
   acción es rechazada.
4. **Given** una categoría usada por gastos, **When** se desactiva, **Then** deja de ofrecerse
   para nuevos gastos pero los existentes la conservan.

---

### User Story 6 - Dashboard, gastos personales y filtros (Priority: P2)

Como participante, quiero un resumen del viaje con totales, mi aporte, mi consumo, mis deudas y
un gráfico por categoría, con los gastos personales en una pestaña aparte, y poder filtrar por
fecha, categoría, persona y pagador.

**Why this priority**: da visibilidad y confianza; depende de que existan gastos y privacidad.

**Independent Test**: con gastos compartidos y personales, el dashboard de Ana muestra total
compartido, total personal y total global (= compartido + personal de Ana), y los filtros
reducen la lista y el gráfico coherentemente.

**Acceptance Scenarios**:

1. **Given** gastos compartidos y personales, **When** Ana abre el dashboard, **Then** ve: total
   compartido del viaje, su aporte, su consumo compartido, su gasto personal, su total global y
   su saldo.
2. **Given** la pestaña «Personales», **When** Ana la abre, **Then** ve solo sus gastos
   personales y sus estadísticas, que no suman al total compartido.
3. **Given** filtros por rango de fechas y categoría, **When** se aplican, **Then** la lista, los
   totales y el gráfico reflejan solo los gastos filtrados que Ana puede ver.
4. **Given** el gráfico por categoría, **When** se muestra, **Then** cada categoría muestra su
   importe en la moneda del viaje, calculado solo sobre los gastos que el usuario puede ver, y
   los importes suman el total de esos gastos.

---

### User Story 7 - Aviso de posible duplicado (Priority: P3)

Como participante, quiero que se me avise si estoy registrando un gasto que parece repetido, sin
impedírmelo, para evitar dobles cargos.

**Why this priority**: mejora la calidad de datos; no bloquea el flujo principal.

**Independent Test**: registrar dos veces USD 45.00 el mismo día con el mismo pagador; el segundo
intento muestra el aviso y solo se guarda tras confirmar.

**Acceptance Scenarios**:

1. **Given** un gasto vigente con mismo total, misma fecha de transacción y algún pagador en
   común, **When** se intenta guardar otro igual, **Then** se muestra «Posible duplicado» con el
   gasto parecido y se exige confirmación explícita.
2. **Given** el aviso, **When** el usuario confirma, **Then** se guarda; **When** cancela,
   **Then** vuelve al formulario sin perder datos.
3. **Given** un doble toque en «Guardar» o un reintento por red, **When** llega dos veces la misma
   solicitud, **Then** se guarda una sola vez (sin aviso, por idempotencia).

---

### Edge Cases

- Gasto con un único beneficiario que no es el pagador (compartido de una persona) frente a
  gasto personal pagado por otro: el primero cuenta como compartido; el segundo como personal
  del beneficiario con deuda hacia el pagador.
- Factura con todos los ítems personales: no suma nada al total compartido.
- Descuento general mayor que la suma de ítems: no se puede guardar.
- Monedas sin decimales (JPY, CLP) o con 3 (KWD): los campos de importe aceptan la precisión
  correcta y no permiten más decimales.
- Importes con coma o punto decimal según el idioma del dispositivo: se interpretan sin
  ambigüedad y se guardan como enteros en unidad menor.
- Factura con 100+ ítems: el formulario sigue siendo usable en móvil (selección masiva).
- Participante no involucrado que conoce el identificador de un gasto: no obtiene su detalle.
- Usuario que pierde su rol de admin: deja de ver los detalles de gastos ajenos inmediatamente.
- Categoría desactivada mientras alguien registra un gasto con ella: el guardado la rechaza y
  pide elegir otra.
- Viaje cerrado mientras alguien tiene el formulario abierto: el guardado se rechaza con mensaje
  claro y los datos del formulario no se pierden.
- Anular un gasto ya anulado o por otra persona simultáneamente: solo una anulación tiene efecto.

## Requirements *(mandatory)*

### Functional Requirements

**Registro manual**

- **FR-001**: El inicio de un viaje activo MUST mostrar los accesos «Registro manual» (activo) y
  «Escanear factura» (deshabilitado, «Próximamente») (RF-25).
- **FR-002**: Cualquier participante aceptado MUST poder registrar gastos en un viaje activo; el
  sistema registra por separado quién lo registró y quién pagó (RF-04).
- **FR-003**: El formulario MUST ofrecer dos modos: reparto del total entre beneficiarios y
  reparto por ítems (RF-05).
- **FR-004**: Cada ítem (y el total, en el primer modo) MUST permitir reparto en partes iguales,
  importe fijo o porcentaje con hasta 2 decimales (RF-12).
- **FR-005**: El usuario MUST poder seleccionar varios ítems y asignarles beneficiarios y modo en
  lote, y después ajustar ítems individualmente (RF-27).
- **FR-006**: Cada ítem MUST clasificarse como compartido o personal; un ítem personal tiene un
  único beneficiario (RF-42).
- **FR-007**: El formulario MUST permitir descuento por ítem y descuento general, impuestos y
  propinas, cada ajuste general con modo proporcional, equitativo o manual (RF-11, RF-45).
- **FR-008**: El formulario MUST permitir uno o varios pagadores, solo entre participantes del
  viaje, con aportes que sumen el total (RF-07, RF-32).
- **FR-009**: La fecha de transacción MUST ser libre (antes, durante o después del viaje), y la
  fecha de registro se guarda aparte (RF-46).
- **FR-010**: Un gasto MUST poder tener opcionalmente un periodo de servicio (fecha de inicio y
  fin) y seguir siendo un único gasto sin prorrateo diario (RF-23).
- **FR-011**: El formulario MUST mostrar en cada paso la moneda del viaje y el total, calcular en
  vivo la diferencia entre total, ítems, ajustes y aportes, resaltar ítems sin beneficiario y
  bloquear el guardado hasta que todo cuadre; el cálculo en vivo MUST coincidir exactamente con
  el que se guarda.
- **FR-012**: Cada gasto MUST tener una descripción y exactamente una categoría activa del viaje;
  todos sus ítems y ajustes cuentan en esa categoría (no hay categoría por ítem).
- **FR-013**: Importes MUST capturarse solo en la moneda del viaje, respetando sus decimales
  (RF-54).

**Categorías**

- **FR-014**: Cada viaje MUST tener categorías iniciales: Alojamiento, Transporte, Comida,
  Actividades, Compras y Otros (RF-14).
- **FR-015**: Solo creador y administradores MUST poder crear categorías (nombre único en el viaje,
  color) y activarlas/desactivarlas; las categorías no se borran.

**Privacidad**

- **FR-016**: El detalle de un gasto (ítems, reparto por persona, pagadores, ajustes, notas e
  historial) MUST ser visible solo para sus pagadores, sus beneficiarios, su autor, los
  administradores y el creador (RF-38). El acceso es por gasto completo: quien puede verlo ve
  todos sus ítems, incluidos los personales de otros participantes en una factura mixta.
- **FR-017**: Esta regla MUST aplicarse igual en la interfaz, en el acceso directo a los datos y
  en la API; un no involucrado no puede obtener el detalle por ninguna vía.
- **FR-018**: Todos los participantes MUST ver el saldo neto de cada persona y las deudas entre
  personas en ambas vistas, sin productos ni descripciones de gastos ajenos (RF-39).
- **FR-019**: Un participante no involucrado y no administrador MUST NOT ver en la lista ni en
  ningún otro listado los gastos ajenos: esos gastos solo cuentan en los totales agregados del
  viaje y en los saldos y deudas.
- **FR-020**: Los gastos personales MUST ser visibles solo para su beneficiario, su pagador, su
  autor y los administradores, y nunca aparecer en vistas o totales compartidos de otros
  participantes.

**Gastos personales y dashboard**

- **FR-021**: El sistema MUST separar gastos personales de compartidos: los personales no suman
  al total compartido pero sí al total global de su beneficiario (RF-40, RF-41).
- **FR-022**: Un gasto personal pagado por otra persona MUST generar deuda del beneficiario al
  pagador sin clasificarse como compartido (RF-41).
- **FR-023**: El dashboard MUST mostrar: total compartido del viaje, aporte, consumo compartido,
  gasto personal, total global y saldo del usuario, deudas, y un gráfico de gasto compartido por
  categoría (RF-15). El total compartido del viaje se calcula sobre todos los gastos; el gráfico
  por categoría se calcula solo sobre los gastos que el usuario puede ver (admin y creador: todos).
- **FR-024**: Una pestaña «Personales» MUST mostrar solo los gastos personales del usuario con sus
  estadísticas.
- **FR-025**: La lista y el dashboard MUST filtrarse por rango de fechas de transacción,
  categoría, persona (beneficiario) y pagador; los filtros solo operan sobre gastos que el
  usuario puede ver.
- **FR-026**: Los totales por persona (aporte y consumo) de otros participantes MUST mostrarse
  solo a administradores y creador; un participante normal ve los suyos y el saldo neto de todos.

**Lista, detalle, anulación e historial**

- **FR-027**: La lista MUST mostrar, para cada gasto visible: fecha, descripción, categoría, total,
  pagadores y estado; los anulados se marcan y se excluyen de totales y saldos.
- **FR-028**: El detalle MUST mostrar el reparto por persona (compartido/personal), pagadores,
  ítems, ajustes, periodo de servicio y quién lo registró.
- **FR-029**: Autor, creador y administradores MUST poder anular un gasto desde su detalle tras
  confirmación explícita; la anulación es lógica y se refleja en saldos al instante (RF-29, RF-10).
- **FR-030**: El detalle MUST mostrar el historial del gasto (creación, anulación) con actor y
  fecha, visible solo para quien puede ver el detalle.

**Duplicados**

- **FR-031**: Al guardar, si existe un gasto vigente del mismo viaje con el mismo total, la misma
  fecha de transacción y al menos un pagador en común, el sistema MUST advertir «Posible
  duplicado», mostrar el gasto parecido (si el usuario puede verlo) y exigir confirmación
  explícita para guardar (RF-22).
- **FR-032**: Repetir la misma solicitud de guardado MUST producir un solo gasto, sin aviso de
  duplicado (idempotencia).

### Key Entities

- **Gasto**: descripción, categoría, fecha de transacción, fecha de registro, periodo de servicio
  opcional, total, pagadores, ítems, ajustes, estado (vigente/anulado), autor, notas.
- **Agregados del viaje**: total compartido del viaje, saldo neto por persona y deudas; es lo único que un no involucrado percibe de un gasto ajeno (FR-019).
- **Categoría**: nombre, color, inicial o personalizada, activa/inactiva, creada por.
- **Visibilidad de gasto**: conjunto de personas que pueden ver el detalle (pagadores,
  beneficiarios, autor) más administradores y creador.
- **Evento de historial**: acción, actor, fecha y versión, asociado a un gasto.
- **Estadísticas del usuario**: aporte, consumo compartido, gasto personal, total global y saldo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un participante registra un gasto simple en partes iguales en menos de 30 segundos
  desde el inicio del viaje.
- **SC-002**: Una factura de 10 ítems con un ajuste y asignación masiva se registra en menos de
  2 minutos.
- **SC-003**: El 100 % de los gastos guardados desde la interfaz cuadran al centavo (total =
  aportes = cargos). El reparto mostrado antes de guardar coincide con el guardado salvo cuando otro
  gasto se registra simultáneamente (puede cambiar a quién va la unidad sobrante); en ese caso la
  confirmación muestra el reparto definitivo guardado.
- **SC-004**: 0 accesos al detalle de gastos ajenos por participantes no involucrados en las
  pruebas de privacidad (interfaz, enlace directo y acceso directo a datos).
- **SC-005**: Los totales del dashboard coinciden con la suma de los gastos visibles filtrados en
  el 100 % de los casos, y total global = compartido + personal para cada usuario.
- **SC-006**: El 100 % de los intentos de guardar un posible duplicado muestran el aviso antes de
  guardar, y los reintentos idénticos generan un único gasto.
- **SC-007**: Las pantallas de registro, lista, detalle y dashboard cumplen WCAG 2.1 AA y son
  usables en un móvil de 360 px de ancho.
- **SC-008**: Con 1.000 gastos en un viaje, la lista muestra la primera página y el dashboard sus
  totales en menos de 3 segundos en una red móvil razonable.

## Assumptions

- Base existente (feature 001): motor financiero, registro y anulación de gastos por servicio,
  saldos y vistas de deudas, roles y estados del viaje.
- El autor de un gasto (quien lo registra) puede ver su detalle aunque no sea pagador ni
  beneficiario.
- La categoría por defecto en el formulario es la última usada por el usuario o «Otros».
- El criterio de duplicado es: mismo viaje, mismo total, misma fecha de transacción y al menos un
  pagador en común entre gastos vigentes.
- Las categorías iniciales se crean al crear el viaje (y se añaden a viajes existentes de la
  Fase 1 al primer uso).
- La anulación pide confirmación pero no muestra vista previa de impacto (Fase 3).
- El gráfico por categoría incluye solo gasto compartido; los personales tienen su pestaña.
- Notas del gasto: texto libre opcional de hasta 500 caracteres.
- Volumen máximo soportado: 1.000 gastos por viaje; la lista se pagina de 50 en 50.
- Sin adjuntos en esta fase: el registro manual no exige comprobante (RF-13).
