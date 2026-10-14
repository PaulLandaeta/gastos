# Feature Specification: PWA y colaboración (Fase 5)

**Feature Branch**: `005-pwa-offline-collaboration`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Fase 5 del PRD: PWA y colaboración. Construye sobre 001-004. Incluye: (a) offline básico y PWA instalable (RF-17, RF-49, RF-36): instalar la app; consultar sin conexión lo ya visto; crear gastos manuales sin conexión en una cola local que se sincroniza sin duplicarse; conflictos de sincronización resueltos explícitamente; indicador sin conexión y pendientes; límites de caché; escaneo IA, pagos y adjuntos requieren conexión; (b) notificaciones internas (RF-18): bandeja con eventos relevantes, leído/no leído, contador y navegación, respetando RF-38; sin push ni email; (c) exportación Excel/PDF (RF-19) sujeta a privacidad, nunca pública ni permanente. Ya existen: filtros, categorías, cierre y archivo. Fuera de alcance: push/email, borrado de cuenta (Fase 6), despliegue."

## Clarifications

### Session 2026-10-14

- Q: ¿Qué se guarda para usar sin conexión (límites de caché, PRD #10)? → A: viajes abiertos en los últimos 30 días, hasta ~50 MB por cuenta; al superarse se expulsan primero los viajes menos usados; los pendientes nunca se expulsan.
- Q: ¿Qué exporta cada rol (PRD #11)? → A: todo participante aceptado exporta exactamente lo que ve en la app (detalle de gastos visibles + saldos y deudas de todos); creador y administradores exportan todo.
- Q: ¿Cuándo notifica la edición de un gasto? → A: solo si cambia la parte del usuario (lo que pagó o consume) o si se le añade o quita del gasto; ediciones de descripción, categoría o fecha no notifican.
- Q: ¿Qué se puede hacer con un gasto pendiente antes de sincronizarse? → A: el autor puede editarlo o descartarlo libremente en su dispositivo (con o sin conexión), conservando la misma clave de idempotencia; queda bloqueado solo mientras se está enviando.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrar gastos sin conexión (Priority: P1)

Durante el viaje (salar, carretera, avión) Ana no tiene señal. Abre la app instalada en su teléfono, consulta el viaje
y los saldos que vio por última vez y registra a mano la cena que acaba de pagar. El gasto queda marcado como
«pendiente de sincronizar». Cuando recupera la conexión, la app lo envía sola, una sola vez, y el gasto pasa a formar
parte de los saldos de todos.

**Why this priority**: es la razón principal de la Fase 5 (RF-17) y el escenario más frecuente en un viaje: sin él,
los gastos se olvidan o se anotan fuera de la app.

**Independent Test**: con la app ya abierta una vez, cortar la red, registrar dos gastos, recargar la app (sigue
mostrando datos y pendientes), restablecer la red y comprobar que aparecen exactamente dos gastos nuevos y los
saldos cuadran.

**Acceptance Scenarios**:

1. **Given** un viaje activo visto antes con conexión, **When** Ana abre la app sin conexión, **Then** ve el viaje, sus
   gastos visibles, saldos y pagos tal como estaban la última vez, con un indicador claro de «sin conexión» y la fecha
   de la última actualización.
2. **Given** Ana sin conexión, **When** registra un gasto manual válido (cuadra con el total), **Then** se guarda en el
   dispositivo como pendiente, se muestra en su lista con la etiqueta «pendiente» y el contador de pendientes aumenta.
3. **Given** gastos pendientes, **When** vuelve la conexión, **Then** se envían automáticamente, cada uno se registra
   una sola vez aunque el envío se repita o se corte a mitad, y desaparece la etiqueta «pendiente».
4. **Given** un gasto pendiente, **When** al sincronizarse el servidor lo rechaza (viaje cerrado, participante o
   categoría que ya no es válida, sin acceso, posible duplicado), **Then** el gasto queda como «requiere atención»
   con el motivo, y Ana puede corregirlo y reenviarlo o descartarlo explícitamente; nunca se pierde en silencio.
5. **Given** Ana sin conexión, **When** intenta escanear, pagar, editar, adjuntar o exportar, **Then** la app indica
   que esa acción necesita conexión, sin perder lo escrito.

---

### User Story 2 - Instalar la app en el teléfono (Priority: P1)

Pedro quiere tener la app como un icono más en su teléfono, abrirla a pantalla completa y que funcione aunque la red
sea mala.

**Why this priority**: RF-49; habilita el uso offline y los accesos rápidos móviles (RF-25).

**Independent Test**: en un navegador compatible, la app ofrece instalarse, se abre a pantalla completa desde el
icono y, sin conexión, muestra la pantalla del viaje en vez de un error del navegador.

**Acceptance Scenarios**:

1. **Given** un navegador compatible (Android Chrome, iOS Safari «Añadir a pantalla de inicio»), **When** Pedro visita
   la app, **Then** puede instalarla con nombre, icono y color propios, y se abre sin barra del navegador.
2. **Given** la app instalada, **When** se publica una versión nueva, **Then** la app avisa y se actualiza sin perder
   los gastos pendientes.
3. **Given** la app instalada y sin conexión, **When** Pedro la abre, **Then** ve sus viajes (no una página de error).

---

### User Story 3 - Notificaciones dentro de la app (Priority: P2)

Juan quiere enterarse, al abrir la app, de lo que le afecta: un gasto nuevo donde participa, un pago que debe
confirmar, un pago suyo confirmado o rechazado, una devolución, un comprobante por vencer, una invitación o un cambio
de estado del viaje.

**Why this priority**: RF-18; mejora la colaboración, pero la app ya es usable sin ella.

**Independent Test**: Ana registra un gasto que incluye a Juan y otro que no; Juan ve una sola notificación nueva, el
contador muestra 1, al tocarla navega al gasto y queda leída.

**Acceptance Scenarios**:

1. **Given** un gasto nuevo o editado en el que Juan es pagador o beneficiario, **When** se guarda, **Then** Juan
   recibe una notificación con el viaje, la descripción y su parte; quien hizo el cambio no se notifica a sí mismo.
   Si la edición no cambia la parte de Juan (solo descripción, categoría o fecha), no recibe notificación.
2. **Given** un gasto en el que Juan no participa y no es administrador, **When** se guarda, **Then** Juan no recibe
   ninguna notificación que revele su existencia o contenido (RF-38).
3. **Given** un pago registrado hacia Juan, **When** está pendiente, **Then** Juan recibe «pago por confirmar»; al
   confirmarse o rechazarse, el emisor recibe el resultado.
4. **Given** notificaciones no leídas, **When** Juan abre la bandeja, **Then** ve el contador, puede marcar una o todas
   como leídas o volver a marcarlas no leídas, y al tocar una navega al elemento.
5. **Given** el elemento ya no es accesible (gasto anulado del que Juan dejó de ser parte), **When** toca la
   notificación, **Then** ve «ya no disponible» sin revelar detalles.

---

### User Story 4 - Exportar el viaje a Excel y PDF (Priority: P2)

Al terminar el viaje, Ana (creadora) quiere un Excel con todo el detalle para archivarlo y un PDF resumen para
compartir con el grupo. Pedro (participante) quiere su propia exportación.

**Why this priority**: RF-19; cierra el ciclo del viaje. Depende de que la privacidad ya esté resuelta (001–004).

**Independent Test**: Pedro exporta un viaje con un gasto privado de Ana del que no participa; ni el Excel ni el PDF
contienen ese detalle, pero los saldos coinciden con los de la app.

**Acceptance Scenarios**:

1. **Given** un viaje, **When** un participante exporta a Excel, **Then** obtiene un archivo con hojas de gastos
   (fecha de transacción, descripción, categoría, total, pagadores, estado), ítems y reparto por persona, pagos,
   devoluciones y saldos y deudas en vista original y simplificada, en la moneda del viaje, con los totales cuadrando
   al centavo.
2. **Given** un gasto que el participante no puede ver, **When** exporta, **Then** ese gasto no aparece en el detalle;
   los saldos y deudas (públicos, RF-39) sí aparecen y coinciden con la app.
3. **Given** el creador o un administrador, **When** exporta, **Then** el archivo incluye todos los gastos.
4. **Given** un PDF resumen, **When** se genera, **Then** muestra totales del viaje, totales por categoría, aporte y
   consumo por persona y quién debe a quién, legible en móvil e imprimible.
5. **Given** una exportación, **When** se descarga, **Then** el archivo se entrega solo a quien la pidió, no queda
   almacenado en un enlace público ni permanente y la acción queda registrada en la auditoría.

---

### Edge Cases

- Dos dispositivos del mismo usuario con gastos pendientes: cada gasto se identifica de forma única y no se mezcla.
- El usuario cierra sesión con gastos pendientes: se le advierte; si confirma, los pendientes se descartan de ese
  dispositivo (nunca quedan accesibles para otra cuenta en el mismo dispositivo).
- Otra cuenta inicia sesión en el mismo dispositivo: no ve la caché ni los pendientes de la anterior.
- Mientras Ana estaba sin conexión el primer gasto de otro bloqueó participantes y moneda: su gasto se sincroniza
  igual si sigue siendo válido (participantes congelados no cambian; moneda fija).
- Se pierde el acceso a un viaje (expulsado antes de aceptar) mientras hay pendientes: quedan como «requiere atención»
  sin poder reenviarse; solo se pueden descartar.
- Un gasto pendiente parece duplicado de otro ya sincronizado: se pide confirmación explícita (RF-22) antes de enviarlo.
- La caché local supera su límite o caduca: se eliminan los datos más antiguos de viajes no abiertos recientemente;
  nunca se eliminan gastos pendientes.
- Permisos que cambiaron mientras estaba sin conexión (degradado de admin): al reconectar, la caché se actualiza y
  deja de mostrar detalles que ya no puede ver.
- Exportación de un viaje con miles de gastos: se completa sin bloquear la app y con aviso de progreso.
- Viaje archivado: se puede consultar offline y exportar; no se pueden crear gastos.
- Notificaciones antiguas: se conservan un período limitado y luego se eliminan.

## Requirements *(mandatory)*

### Functional Requirements

**Instalación y offline**

- **FR-001**: La app MUST poder instalarse en navegadores compatibles (Android, iOS, escritorio) con nombre, iconos y
  apertura a pantalla completa, y MUST abrir su interfaz sin conexión (RF-49).
- **FR-002**: Los datos ya consultados (viajes, miembros, categorías, gastos visibles, saldos, pagos) MUST estar
  disponibles sin conexión, mostrando que son datos guardados y la fecha de la última actualización (RF-17).
- **FR-003**: Sin conexión, el usuario MUST poder crear gastos manuales (total o por ítems) con las mismas validaciones
  de la Fase 2; el gasto queda pendiente en el dispositivo con una clave de idempotencia fijada al crearlo.
- **FR-003a**: Mientras un gasto esté pendiente (no enviándose), su autor MUST poder editarlo con las mismas validaciones o
  descartarlo, con o sin conexión; la edición conserva la clave de idempotencia. Durante el envío el gasto MUST quedar
  bloqueado para edición.
- **FR-004**: Al recuperar conexión, los pendientes MUST enviarse automáticamente en orden de creación, sin
  duplicarse aunque el envío se repita; el usuario MUST poder forzar un reintento.
- **FR-005**: Un pendiente rechazado al sincronizar MUST quedar en «requiere atención» con el motivo; el usuario MUST
  poder corregirlo y reenviarlo o descartarlo. Un conflicto de versión o permisos nunca se resuelve automáticamente
  en contra del servidor (RF-36).
- **FR-006**: La app MUST mostrar un indicador permanente de estado sin conexión y el número de gastos pendientes y
  que requieren atención.
- **FR-007**: Escanear, adjuntar, pagar, confirmar pagos, editar, anular, devoluciones, gestión del viaje y exportar
  MUST requerir conexión y comunicarlo sin perder lo introducido.
- **FR-008**: La caché local MUST limitarse a los viajes abiertos en los últimos 30 días y a ~50 MB por cuenta; al
  superar el límite se eliminan primero los viajes usados hace más tiempo. MUST separarse por cuenta y borrarse al
  cerrar sesión; los pendientes nunca se expulsan y solo se borran por decisión explícita del usuario.
- **FR-009**: Cuando cambien los permisos del usuario, la caché MUST dejar de mostrar los detalles que ya no puede ver
  en cuanto haya conexión (RF-38).

**Notificaciones internas**

- **FR-010**: El sistema MUST generar notificaciones internas para: gasto nuevo, anulado o restaurado donde el usuario
  es pagador o beneficiario; gasto editado solo cuando cambia lo que el usuario pagó o consume, o cuando se le añade o
  quita del gasto (ediciones sin impacto en su parte no notifican; al quitado se le notifica sin revelar el detalle); pago por confirmar (receptor); pago confirmado o rechazado (emisor); devolución
  recibida; comprobante por vencer (quienes ven el gasto); cambio de estado del viaje; invitación recibida (RF-18).
- **FR-011**: Una notificación MUST NOT revelar información de gastos que el destinatario no puede ver; el autor de una
  acción no se notifica a sí mismo.
- **FR-012**: Cada usuario MUST ver una bandeja con sus notificaciones (más recientes primero), contador de no leídas,
  marcar como leída/no leída individualmente y todas como leídas, y navegar al elemento.
- **FR-013**: Las notificaciones MUST conservarse 90 días y luego eliminarse; no hay push ni correo.

**Exportación**

- **FR-014**: Cualquier participante aceptado MUST poder exportar un viaje a Excel detallado y a PDF resumen (RF-19).
- **FR-015**: El contenido exportado MUST ser exactamente lo que el solicitante ve en la app: detalle solo de los gastos
  que puede ver; saldos y deudas de todos los participantes siempre (RF-38, RF-39); creador y administradores exportan
  todos los gastos. No existen permisos de exportación adicionales.
- **FR-016**: El Excel MUST incluir: gastos (con fecha de transacción y de registro, estado y origen), ítems con
  cantidades, reparto por persona, pagadores, ajustes, pagos con estado, devoluciones, saldos por persona y deudas en
  vista original y simplificada; importes en la moneda del viaje con sus decimales, cuadrando al centavo con la app.
- **FR-017**: El PDF MUST incluir: datos del viaje, totales compartido/personal, totales por categoría, aporte y consumo
  por persona, deudas simplificadas y fecha de generación.
- **FR-018**: Los archivos exportados MUST entregarse solo al solicitante y no quedar disponibles en un enlace público
  ni permanente; cada exportación MUST registrarse en la auditoría (quién, cuándo, formato).
- **FR-019**: Las exportaciones MUST respetar el filtro de gastos anulados (excluidos de totales, listados aparte).

### Key Entities

- **Gasto pendiente (dispositivo)**: borrador completo de un gasto manual creado sin conexión, editable o descartable
  por su autor hasta que se envía, con su clave de idempotencia, estado (pendiente, enviando, requiere atención, sincronizado), motivo de rechazo y fecha de creación.
- **Caché local**: copia de los datos consultados por la cuenta, con fecha de actualización y límites.
- **Notificación**: destinatario, tipo, viaje, elemento referido, texto mínimo permitido por su visibilidad, leída/no
  leída, fecha y vencimiento.
- **Exportación**: solicitud de un usuario para un viaje y formato; produce un archivo efímero y un evento de auditoría.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100 % de los gastos creados sin conexión se registran exactamente una vez al reconectar, incluso con
  envíos interrumpidos o repetidos (verificado con al menos 20 gastos y cortes de red simulados).
- **SC-002**: Sin conexión, la app abre y muestra el último estado del viaje en menos de 3 segundos en un teléfono de
  gama media.
- **SC-003**: Registrar un gasto sin conexión no tarda más que con conexión (≤ 60 segundos para un gasto simple).
- **SC-004**: Ningún pendiente rechazado se pierde sin una acción explícita del usuario (0 pérdidas en pruebas).
- **SC-005**: El 100 % de las notificaciones respetan la privacidad: 0 notificaciones sobre gastos no visibles en
  pruebas con participantes no involucrados.
- **SC-006**: Las notificaciones aparecen para el destinatario en menos de 10 segundos tras el evento cuando tiene la
  app abierta.
- **SC-007**: Una exportación de un viaje de 1.000 gastos se completa en menos de 30 segundos y sus totales coinciden
  al centavo con la app.
- **SC-008**: 0 detalles de gastos no visibles en exportaciones de participantes no involucrados.
- **SC-009**: La app supera la auditoría de instalabilidad del navegador (manifest, iconos, funcionamiento offline).

## Assumptions

- Offline solo cubre **crear** gastos manuales; editar, anular, pagos, devoluciones, adjuntos y escaneo requieren
  conexión (PRD RF-17 y alcance de la Fase 5).
- Un gasto creado offline no lleva comprobantes; se pueden adjuntar después con conexión.
- La caché conserva los datos de los viajes abiertos en los últimos 30 días (máx. ~50 MB); cada cuenta tiene su propia
  caché.
- Las notificaciones se generan en el servidor junto con la acción que las origina; la bandeja se actualiza en vivo con
  la app abierta. Sin push ni correo (Fase 6+ o fuera del MVP).
- El texto de una notificación de gasto incluye descripción e importe solo porque el destinatario puede ver el gasto;
  las notificaciones de invitación y de estado del viaje no contienen datos financieros.
- La exportación se genera bajo demanda y se descarga directamente; no se almacena en el servidor.
- iOS: la instalación es manual («Añadir a pantalla de inicio») y el almacenamiento offline puede ser limpiado por el
  sistema tras inactividad prolongada; se informa al usuario.
- Volumen: hasta ~1.000 gastos por viaje y 4–10 participantes (decisión de la Fase 2).
