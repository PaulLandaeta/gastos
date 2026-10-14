# Feature Specification: Motor financiero + identidad y viajes (Fase 0–1)

**Feature Branch**: `001-finance-engine-trips`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Fase 0–1 del PRD: motor financiero + identidad y viajes. Incluye: (a) motor financiero puro con importes enteros en unidad menor ISO 4217, reparto igual/fijo/porcentaje por ítem y por total, ajustes de impuesto/propina/descuento (proporcional/equitativo/manual), facturas mixtas personal/compartido, múltiples pagadores, cálculo de saldos (suma cero), pagos confirmados en el saldo, vista de deudas original y simplificada con mismo neto, redondeo determinista con desempate estable (RF-05, RF-07, RF-09, RF-11, RF-12, RF-40–43, RF-45, RF-48); (b) login con Google (RF-01, HU-01); (c) crear múltiples viajes con nombre, fechas y moneda única (RF-02, RF-08); (d) invitar por correo y aceptar/rechazar con email verificado (RF-03, RF-33, HU-02); (e) roles creador/admin/participante, solo el creador gestiona admins (RF-34, RF-35); (f) estados del viaje pending→active→closed/archived con bloqueo de participantes y moneda tras el primer gasto (RF-16, RF-20, RF-44, RF-55). Escenarios críticos: TRIP_NOT_READY si hay invitados pendientes; USD 10.00 entre 3 = 3.34/3.33/3.33; moneda congelada aunque se anule el primer gasto. Fuera de alcance: UI de registro de gastos, IA, adjuntos, liquidaciones de UI, offline, exports."

## Clarifications

### Session 2026-10-13

- Q: En gastos con varios pagadores, ¿cómo se atribuye la deuda en la vista original? → A: La deuda de cada beneficiario se distribuye entre pagadores proporcionalmente a su aporte (redondeo determinista) y luego se compensa por pares (A→B 10 y B→A 4 = A→B 6).
- Q: ¿Qué significa reparto "equitativo" de impuestos/propinas/descuentos generales? → A: Partes iguales entre todas las personas beneficiarias del gasto, independientemente de su consumo.
- Q: ¿Qué precisión admiten los porcentajes de reparto? → A: Hasta 2 decimales (centésimas de punto porcentual); deben sumar exactamente 100,00 %.
- Q: ¿A quién se asigna la unidad menor sobrante en empates de redondeo? → A: Rotativo: cada gasto empieza la asignación en una posición distinta, determinada por su número de secuencia inmutable dentro del viaje, para que los centavos se compensen a lo largo del viaje.
- Q: ¿Qué ocurre con un viaje que nunca se activa? → A: El creador puede archivar un viaje pendiente; al restaurarlo vuelve a pendiente.
- Q: ¿Se puede retirar a un participante que ya aceptó, antes del primer gasto? → A: No. Solo se retiran invitados que no han aceptado (pendientes o que rechazaron); un participante aceptado es permanente.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cálculo financiero exacto y verificable (Priority: P1)

Como grupo de viajeros, necesitamos que cualquier gasto —simple, por productos, mixto
personal/compartido, con impuestos, propinas, descuentos y varios pagadores— se reparta al
centavo exacto y produzca saldos y deudas correctos, para confiar en el resultado sin revisar
hojas de cálculo.

**Why this priority**: es el núcleo del producto y el principal riesgo de integridad (RF-43).
Todas las fases posteriores consumen este cálculo; un error aquí invalida todo lo demás.

**Independent Test**: se valida ejecutando un catálogo de casos de reparto (incluidos los
ejemplos del PRD) y verificando cuotas, saldos y transferencias; no requiere interfaz.

**Acceptance Scenarios**:

1. **Given** un gasto de USD 10.00 para tres beneficiarios por partes iguales, **When** se
   calcula el reparto, **Then** las cuotas son una de USD 3.34 y dos de USD 3.33, y suman USD 10.00; si
   es el gasto n.º 1 del viaje, los USD 3.34 van al primer beneficiario por orden de entrada al
   viaje, en el n.º 2 al segundo y en el n.º 3 al tercero.
2. **Given** una factura con un ítem compartido de USD 30.00 entre Ana y Pedro y un ítem
   personal de Ana de USD 12.00, pagada íntegramente por Pedro, **When** se calculan los saldos,
   **Then** Ana consume USD 27.00, Pedro consume USD 15.00, Pedro tiene saldo +USD 27.00 y Ana
   −USD 27.00; el consumo compartido (USD 30.00) y el personal (USD 12.00) se reportan por
   separado.
3. **Given** un gasto de USD 100.00 pagado USD 60.00 por Ana y USD 40.00 por Juan, **When** los
   aportes no suman el total, **Then** el gasto es rechazado como no conciliado.
4. **Given** una factura con subtotal USD 90.00, impuesto USD 9.00 repartido proporcionalmente,
   propina USD 6.00 repartida equitativamente y un descuento general de USD 5.00, **When** se
   calcula el neto, **Then** la suma de cargos netos por beneficiario es exactamente
   USD 100.00 y ningún ajuste se aplica dos veces.
5. **Given** que Ana debe USD 20.00 a Pedro, **When** existe un pago de Ana a Pedro de
   USD 10.00 en estado pendiente o rechazado, **Then** Ana sigue debiendo USD 20.00; **When** el
   pago está confirmado, **Then** Ana debe USD 10.00.
6. **Given** un viaje con deudas circulares (A debe a B, B debe a C, C debe a A), **When** se
   solicita la vista simplificada, **Then** el saldo neto de cada participante es idéntico al de
   la vista original y el número de transferencias es menor o igual.
7. **Given** cualquier conjunto de gastos y pagos confirmados válidos, **When** se calculan los
   saldos, **Then** la suma de todos los saldos del viaje es exactamente cero.

---

### User Story 2 - Acceso con cuenta Google (Priority: P1)

Como viajero, quiero entrar con mi cuenta de Google para que mis viajes y acciones queden
ligados a mi identidad sin crear otra contraseña.

**Why this priority**: sin identidad no hay viajes, invitaciones ni permisos.

**Independent Test**: un usuario inicia sesión, ve su perfil (nombre, correo, foto), cierra
sesión y deja de tener acceso a sus datos desde ese dispositivo.

**Acceptance Scenarios**:

1. **Given** un visitante sin sesión, **When** inicia sesión con una cuenta Google válida,
   **Then** accede a la aplicación con un identificador persistente que se mantiene entre
   sesiones.
2. **Given** un visitante sin sesión, **When** intenta acceder a cualquier viaje, **Then** se
   le solicita iniciar sesión y no ve ningún dato.
3. **Given** un usuario con sesión, **When** cierra sesión, **Then** la sesión local se revoca
   y los datos en pantalla dejan de estar accesibles.

---

### User Story 3 - Crear viaje e invitar participantes (Priority: P1)

Como creador, quiero crear un viaje con nombre, fechas y moneda, e invitar a mis compañeros por
correo, para que el viaje se active solo cuando todos hayan aceptado.

**Why this priority**: es la puerta de entrada de cualquier registro de gasto (RF-33).

**Independent Test**: un creador crea un viaje, invita a dos correos; el viaje permanece
pendiente hasta que ambos aceptan y entonces pasa a activo.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado, **When** crea un viaje con nombre, fecha de inicio, fecha de
   fin y moneda válida, **Then** el viaje aparece en su lista con él como creador.
2. **Given** un viaje con invitados, **When** al menos uno no ha aceptado, **Then** el viaje
   está en estado pendiente.
3. **Given** un viaje con 4 invitados y 1 pendiente, **When** cualquier participante intenta
   registrar un gasto, **Then** el sistema lo rechaza con `TRIP_NOT_READY`.
4. **Given** una invitación a `ana@example.com`, **When** inicia sesión una persona con un correo
   verificado distinto, **Then** no puede ver ni aceptar esa invitación.
5. **Given** una invitación a `ana@example.com`, **When** Ana inicia sesión con ese correo
   verificado y acepta, **Then** pasa a ser participante; si todos aceptaron, el viaje pasa a
   activo.
6. **Given** un invitado que rechaza, **When** el creador revisa el viaje, **Then** ve el
   rechazo y debe retirar o reemplazar a ese invitado antes de que el viaje pueda activarse.
7. **Given** un usuario con varios viajes, **When** consulta su lista, **Then** ve solo los
   viajes donde es creador, participante o invitado, separados por estado.

---

### User Story 4 - Gestionar roles de administración (Priority: P2)

Como creador, quiero nombrar o retirar administradores para delegar la gestión del viaje sin
perder el control.

**Why this priority**: necesario para la operación colaborativa, pero no bloquea el cálculo ni
la activación.

**Independent Test**: el creador promueve a un participante a admin y lo degrada; un admin
intenta promover a otro y es rechazado.

**Acceptance Scenarios**:

1. **Given** un participante aceptado, **When** el creador lo promueve, **Then** pasa a ser
   administrador.
2. **Given** un administrador, **When** intenta promover o degradar a otra persona, **Then** la
   acción es rechazada.
3. **Given** cualquier usuario, incluido un admin, **When** intenta quitar el rol al creador,
   **Then** la acción es rechazada; el creador conserva su rol de forma permanente.

---

### User Story 5 - Ciclo de vida del viaje y bloqueos (Priority: P2)

Como creador o administrador, quiero cerrar y reabrir el viaje, y como creador archivarlo y
restaurarlo, sabiendo que la moneda y los participantes quedan fijos desde el primer gasto.

**Why this priority**: protege la integridad de los datos una vez que hay movimientos.

**Independent Test**: se registra un primer gasto a nivel de servicio, se anula, y se verifica
que moneda y participantes siguen bloqueados; se cierra, reabre, archiva y restaura el viaje.

**Acceptance Scenarios**:

1. **Given** un viaje activo, **When** el creador o un admin lo cierra, **Then** queda en solo
   lectura y cualquier mutación es rechazada; **When** lo reabre, **Then** vuelve a activo.
2. **Given** un viaje pendiente, activo o cerrado, **When** el creador lo archiva, **Then** queda en solo
   lectura, oculto de la lista de activos; **When** lo restaura, **Then** recupera el estado que
   tenía antes de archivarse.
3. **Given** un viaje con un primer gasto creado y luego anulado, **When** el creador intenta
   cambiar la moneda de USD a BOB, **Then** el sistema rechaza el cambio.
4. **Given** un viaje con al menos un gasto registrado (aunque esté anulado), **When** el
   creador intenta invitar nuevos participantes o retirar/reemplazar invitados, **Then** el
   sistema lo rechaza.
6. **Given** un viaje sin gastos y un participante que ya aceptó, **When** el creador intenta
   retirarlo, **Then** el sistema lo rechaza con `MEMBER_ALREADY_ACCEPTED`.
5. **Given** un admin, **When** intenta archivar o restaurar el viaje, **Then** la acción es
   rechazada.

---

### Edge Cases

- 1 unidad menor (USD 0.01) entre N beneficiarios: solo uno recibe la unidad, según la
  rotación de FR-007; en gastos sucesivos del mismo tipo la unidad va rotando entre ellos.
- Monedas sin decimales (p. ej. JPY, CLP) y con tres decimales (p. ej. KWD, BHD): el reparto
  usa la unidad menor correcta de cada moneda.
- Porcentajes con más de 2 decimales o que no suman exactamente 100,00 %, o importes fijos que no suman el neto del ítem: el reparto es
  rechazado como no conciliado.
- Descuento por ítem combinado con descuento general: ambos se aplican una sola vez y el total
  concilia; un descuento mayor que el importe del ítem es rechazado.
- Asignaciones negativas (descuentos) también se redondean con el mismo algoritmo
  determinista.
- Ítem sin beneficiarios: el gasto es rechazado como incompleto.
- Pagador que no es participante aceptado del viaje: rechazado.
- Gasto personal pagado por otra persona: genera deuda del beneficiario al pagador sin
  clasificarse como compartido (RF-41).
- Reordenar visualmente participantes o ítems no cambia ningún resultado; editar un gasto
  conserva su número de secuencia y, por tanto, su rotación.
- Viaje sin invitados (solo el creador): pasa a activo de inmediato.
- Fecha de fin anterior a la de inicio: rechazada.
- Invitar dos veces el mismo correo o al propio creador: rechazado.
- Retirar a un participante que ya aceptó: rechazado siempre, incluso antes del primer gasto.
- Invitación a un correo cuya cuenta Google no tiene correo verificado: no puede aceptarse.
- Dos aceptaciones simultáneas o un intento de gasto simultáneo a la última aceptación: el
  estado final es coherente y nunca se registra un gasto con invitados pendientes.
- Usuario que pierde la sesión durante una operación: la operación se rechaza sin efectos
  parciales.

## Requirements *(mandatory)*

### Functional Requirements

**Motor financiero**

- **FR-001**: El sistema MUST representar todo importe como un número entero en la unidad menor
  de la moneda del viaje, según el número de decimales que define ISO 4217 para esa moneda.
- **FR-002**: El sistema MUST permitir repartir el total de un gasto entre beneficiarios
  seleccionados en partes iguales, importes fijos o porcentajes (RF-05). Los porcentajes admiten
  hasta 2 decimales y MUST sumar exactamente 100,00 %; el residuo resultante en importe se
  asigna con el redondeo de FR-007.
- **FR-003**: El sistema MUST permitir repartir cada ítem de una factura entre sus beneficiarios
  en partes iguales, importe fijo o porcentaje, y la suma de cuotas MUST igualar el neto del
  ítem (RF-12).
- **FR-004**: El sistema MUST aplicar impuestos, propinas y descuentos generales con modo
  proporcional (según el consumo de cada beneficiario antes del ajuste), equitativo (partes
  iguales entre todas las personas beneficiarias del gasto, sin importar su consumo) o manual
  (importe por persona que debe sumar el ajuste), y descuentos por ítem, sin aplicarlos dos
  veces y conciliando el total (RF-11, RF-45).
- **FR-005**: El sistema MUST clasificar cada ítem como personal o compartido, permitir ambos en
  una misma factura y reportar por separado el consumo compartido, el personal y el global
  combinado (RF-40, RF-42).
- **FR-006**: El sistema MUST aceptar uno o varios pagadores por gasto, todos participantes
  aceptados del viaje, y rechazar el gasto si la suma de aportes no es igual al total (RF-07,
  RF-32).
- **FR-007**: El sistema MUST redondear de forma determinista: calcular cuotas exactas,
  truncar a la unidad menor, ordenar residuos de mayor a menor y asignar las unidades restantes;
  entre residuos iguales, el desempate es rotativo: los beneficiarios se ordenan por orden de
  entrada al viaje (creador primero, luego fecha de aceptación, luego identificador) y la
  asignación empieza en la posición `(número de secuencia del gasto − 1 + índice estable del ítem)
  mod N` (secuencia desde 1, índice de ítem desde 0), continuando en ciclo. El número de secuencia se asigna al crear el gasto, es inmutable
  y no cambia con ediciones ni anulaciones de otros gastos. Aplica también a importes negativos
  (RF-43).
- **FR-008**: El sistema MUST calcular el saldo de cada participante como aportes − consumos +
  pagos confirmados enviados − pagos confirmados recibidos; saldo positivo es acreedor y
  negativo deudor; la suma de saldos del viaje MUST ser cero.
- **FR-009**: El sistema MUST ignorar los pagos pendientes y rechazados en el cálculo de saldos
  y contar solo los confirmados (RF-21).
- **FR-010**: El sistema MUST excluir los gastos anulados del cálculo de saldos.
- **FR-011**: El sistema MUST ofrecer dos vistas de deudas: la original (deudas entre pares:
  el cargo de cada beneficiario se distribuye entre los pagadores del gasto en proporción a su
  aporte, con el redondeo de FR-007; los pagos confirmados se aplican al par emisor/receptor; y
  las deudas en ambos sentidos de cada par se compensan en un único importe neto) y la simplificada (propuesta con menos o igual número de
  transferencias), ambas con el mismo saldo neto por participante; la simplificada es solo una
  propuesta y no crea pagos (RF-09, RF-48).
- **FR-012**: El resultado de la vista simplificada MUST ser determinista: mismos datos de
  entrada producen siempre las mismas transferencias.

**Identidad**

- **FR-013**: Los usuarios MUST iniciar sesión con una cuenta Google; toda acción queda ligada a
  su identificador persistente (RF-01).
- **FR-014**: El sistema MUST registrar el perfil básico del usuario (nombre visible, correo,
  foto) al primer inicio de sesión.
- **FR-015**: Cerrar sesión MUST revocar la sesión local y ocultar los datos del usuario en ese
  dispositivo.
- **FR-016**: Ningún dato de viaje MUST ser accesible sin sesión válida ni para usuarios que no
  sean creador, participante o invitado de ese viaje.

**Viajes, invitaciones y roles**

- **FR-017**: Los usuarios MUST poder crear múltiples viajes con nombre, fecha de inicio, fecha
  de fin y una única moneda ISO 4217 válida; los datos de cada viaje están aislados (RF-02,
  RF-08).
- **FR-018**: Solo el creador MUST poder invitar participantes por correo electrónico, antes del
  primer gasto (RF-03, RF-20).
- **FR-019**: Una invitación MUST poder aceptarse o rechazarse solo por un usuario cuyo correo
  verificado coincida con el invitado; la coincidencia no puede ser declarada por el propio usuario (RF-03).
- **FR-020**: El viaje MUST permanecer en estado pendiente mientras exista algún invitado sin
  aceptar o rechazado sin resolver, y pasar a activo automáticamente cuando todos aceptaron
  (RF-33).
- **FR-021**: El sistema MUST rechazar con `TRIP_NOT_READY` cualquier registro de gasto en un
  viaje que no esté activo por invitaciones pendientes.
- **FR-022**: El creador MUST poder retirar o reemplazar invitados que aún no aceptaron
  (pendientes o que rechazaron) antes del primer gasto. Un participante que ya aceptó MUST NOT
  poder ser retirado en ningún momento (`MEMBER_ALREADY_ACCEPTED`).
- **FR-023**: El sistema MUST soportar los roles creador, administrador y participante; el
  creador es único y permanente (RF-34, RF-35).
- **FR-024**: Solo el creador MUST poder promover participantes a administrador o degradarlos.

**Estados y bloqueos**

- **FR-025**: El viaje MUST tener los estados pendiente, activo, cerrado y archivado con estas
  transiciones: pendiente→activo (automática cuando todos aceptaron), activo→pendiente
  (automática si el creador invita a alguien antes del primer gasto), activo→cerrado y cerrado→activo (creador o
  admin), pendiente|activo|cerrado→archivado y archivado→estado previo (solo creador) (RF-16, RF-44).
- **FR-026**: En estados cerrado y archivado, el sistema MUST rechazar toda mutación de gastos,
  pagos, participantes, roles y datos del viaje, excepto la transición de estado permitida.
- **FR-027**: Al registrarse el primer gasto, el sistema MUST bloquear de forma permanente la
  lista de participantes y la moneda, aunque ese gasto se anule después (RF-20, RF-55).
- **FR-028**: Esta feature MUST incluir la capacidad de registrar y anular un gasto a nivel de
  servicio (sin interfaz de captura), validado por el motor financiero, sujeto a membresía,
  estado del viaje (`TRIP_NOT_READY`, solo lectura) y versión; esto hace verificables de
  extremo a extremo los bloqueos de FR-027. La pantalla de captura se entrega en la Fase 2.
- **FR-029**: El creador y los administradores MUST poder editar nombre y fechas del viaje
  mientras esté pendiente o activo; la moneda solo es editable antes del primer gasto.
- **FR-030**: Toda mutación de viaje, invitación, rol o estado MUST registrar un evento de
  auditoría con actor, momento, acción, entidad y versión previa/nueva.
- **FR-031**: Las mutaciones concurrentes sobre el mismo viaje MUST resolverse sin estados
  inconsistentes; una edición con versión desactualizada es rechazada con `CONFLICT`.

### Key Entities

- **Usuario**: persona autenticada con Google; identificador persistente, nombre visible,
  correo verificado, foto.
- **Viaje**: nombre, fechas, moneda, estado, estado previo (para restaurar archivado), creador,
  indicadores de bloqueo de participantes y moneda, fecha del primer gasto, versión.
- **Miembro del viaje**: vínculo usuario–viaje con correo invitado, rol
  (creador/admin/participante) y estado de invitación (invitado/aceptado/rechazado).
- **Gasto**: número de secuencia inmutable dentro del viaje, total, pagadores con sus aportes, ítems, estado (vigente/anulado), autor, versión.
- **Ítem**: descripción, importe bruto, descuento, impuesto y propina asignados, neto,
  clasificación personal/compartido, asignaciones a beneficiarios.
- **Asignación**: beneficiario, importe en unidad menor, modo (igual/fijo/porcentaje).
- **Pago**: emisor, receptor, importe, estado (pendiente/confirmado/rechazado).
- **Saldo**: resultado derivado por participante; nunca fuente de verdad.
- **Transferencia propuesta**: deudor, acreedor e importe de la vista simplificada.
- **Evento de auditoría**: actor, momento, acción, entidad, versiones y cambios redactados.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de los casos del catálogo de reparto (incluidos los ejemplos del PRD) y al
  menos 10.000 casos generados aleatoriamente con hasta 50 participantes y 100 ítems
  concilian al centavo y suman cero en saldos.
- **SC-002**: La vista simplificada conserva el saldo neto de cada participante en el 100% de
  los casos y nunca propone más transferencias que la vista original.
- **SC-003**: Repetir el mismo cálculo con los datos en distinto orden produce resultados
  idénticos en el 100% de los casos.
- **SC-004**: Un usuario nuevo inicia sesión y crea su primer viaje con invitados en menos de
  2 minutos.
- **SC-005**: Un invitado acepta una invitación en menos de 30 segundos desde que inicia sesión.
- **SC-006**: 0 casos de acceso a un viaje por usuarios no vinculados en las pruebas de
  permisos, y 0 gastos registrados con invitados pendientes.
- **SC-007**: El 100% de los intentos de cambiar moneda o participantes tras el primer gasto,
  y de mutar viajes cerrados o archivados, son rechazados.
- **SC-008**: Los 3 escenarios críticos del enunciado (`TRIP_NOT_READY`, 10.00/3, moneda
  congelada) pasan como pruebas automáticas.

## Assumptions

- Registro y anulación de gastos se exponen solo como capacidad de servicio (sin UI) en esta
  feature; se ejercitan mediante pruebas automatizadas.
- Se incluyen las pantallas de inicio de sesión, lista de viajes, creación de viaje,
  invitaciones/aceptación, gestión de roles y acciones de estado; no se incluye la pantalla de
  registro de gastos, liquidaciones, IA, adjuntos, offline ni exportaciones.
- El catálogo de monedas es la lista activa de ISO 4217 con sus decimales oficiales.
- Un viaje sin invitados (solo el creador) se activa inmediatamente.
- Las invitaciones no envían correo (push/email excluidos del MVP); el invitado ve la
  invitación al iniciar sesión con el correo invitado.
- Modo por defecto de impuestos y propinas: proporcional; descuento general: proporcional.
- Un gasto puede tener fechas fuera del rango del viaje (RF-46); no aplica validación de rango.
- En viaje cerrado o archivado no se confirman pagos pendientes (recomendación del PRD §5.1);
  se exige reapertura.
- Máximo orientativo de 50 participantes por viaje para dimensionar pruebas.
- La vista simplificada usa un algoritmo voraz determinista (mayor deudor con mayor acreedor);
  no se garantiza el mínimo teórico absoluto de transferencias.
- La privacidad de detalle de gastos (RF-38) se aplica completa en la Fase 2; esta feature
  garantiza aislamiento por viaje y por membresía.
