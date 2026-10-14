# Feature Specification: IA y adjuntos (Fase 4)

**Feature Branch**: `004-receipts-ai-attachments`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Fase 4 del PRD: IA y adjuntos. Construye sobre 001-003. Incluye: (a) adjuntos de gasto (RF-13, RF-30) con duplicados por checksum, límites de tipo/tamaño y visibilidad RF-38 mediante enlaces temporales; (b) escaneo con IA (RF-06, RF-26, RF-31, RF-50, HU-04): «Escanear factura» con cámara o fotos/PDF, proveedor intercambiable (Gemini inicial), borrador validado con confianza por campo y advertencias, abierto en el formulario de 002, bloqueo hasta que cuadre, moneda detectada solo como advertencia (RF-54), adjuntos vinculados al gasto; (c) cuotas IA combinadas (RF-51, HU-16) atómicas, sin costo al agotarse, registro manual siempre disponible, métricas; (d) retención 6 meses (RF-52, RF-53) con proceso programado idempotente, aviso previo y trazabilidad; (e) comprobante opcional en pagos (RF-21). Fuera de alcance: offline, exportaciones, notificaciones push/email, OpenAI (solo contrato), borrado de cuenta."

## Clarifications

### Session 2026-10-13

- Q: ¿Cómo se trata la privacidad del nivel gratuito de Gemini? → A: Consentimiento explícito de cada usuario antes del primer escaneo, revocable; sin él solo registro manual.
- Q: ¿Qué límites iniciales de cuota? → A: 20 análisis/viaje/día; global 100/día y 1.500/mes; máx. 5 archivos y 10 páginas por análisis (configurables).
- Q: ¿Con cuánta antelación y a quién se avisa del vencimiento? → A: 14 días antes, en el gasto y en el inicio del viaje, solo para quienes pueden ver ese gasto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Escanear una factura y revisarla antes de guardar (Priority: P1)

Como participante, quiero fotografiar o subir una factura y obtener un borrador con comercio,
fecha, productos, impuestos, propina y total, que pueda corregir y repartir antes de guardarlo,
para registrar facturas largas sin teclear cada línea.

**Why this priority**: es la promesa principal del PRD (RF-06, HU-04) y el botón «Escanear
factura» lleva deshabilitado desde la Fase 2.

**Independent Test**: subir la foto de un ticket de 4 productos; el formulario se abre con los 4
ítems, la fecha y el total detectados, los campos dudosos resaltados; tras asignar beneficiarios y
cuadrar, se guarda y la imagen queda adjunta al gasto.

**Acceptance Scenarios**:

1. **Given** un viaje activo, **When** el participante pulsa «Escanear factura» y toma una foto o
   elige imágenes/PDF, **Then** recibe un borrador con comercio, fecha de transacción, ítems
   (descripción, cantidad, precio), subtotal, impuestos, propina, descuentos y total.
2. **Given** un borrador, **When** se abre en el formulario, **Then** los campos con baja confianza
   o advertencias se resaltan y el usuario puede editar cualquier valor.
3. **Given** un borrador cuyos ítems y ajustes no suman el total detectado, **When** el usuario
   intenta guardar, **Then** el guardado está bloqueado y se muestra la diferencia hasta que cuadre.
4. **Given** una factura en una moneda distinta a la del viaje, **When** se analiza, **Then** se
   muestra una advertencia y los importes se guardan en la moneda del viaje tras la corrección
   manual del usuario (sin conversión automática).
5. **Given** el borrador guardado, **When** se abre el gasto, **Then** las imágenes/PDF analizados
   aparecen como sus comprobantes y el origen del gasto figura como «escaneado».
6. **Given** que la IA no responde o falla, **When** se escanea, **Then** se informa del error, no
   se pierde la foto y el usuario puede continuar con el registro manual con la imagen adjunta.

---

### User Story 2 - Adjuntar comprobantes a un gasto (Priority: P1)

Como participante, quiero adjuntar fotos o PDF a un gasto al crearlo o más tarde, y que solo quien
puede ver el gasto pueda abrirlos, para tener respaldo sin exponer información privada.

**Why this priority**: completa RF-13/RF-30 y el escenario PRD «Usuario sin acceso al comprobante
privado» en su parte de archivos.

**Independent Test**: adjuntar dos imágenes y un PDF de 3 páginas a un gasto; un participante no
involucrado no puede abrirlos ni con un enlace copiado; un enlace caducado deja de funcionar.

**Acceptance Scenarios**:

1. **Given** un gasto que puede ver, **When** un participante autorizado sube varias imágenes o
   PDF, **Then** quedan adjuntos con nombre, tipo, tamaño, páginas y fecha de carga.
2. **Given** un archivo ya adjunto al mismo gasto, **When** se sube otra vez el mismo contenido,
   **Then** se avisa que es un duplicado y no se guarda dos veces.
3. **Given** un archivo de tipo no permitido o que supera el tamaño máximo, **When** se intenta
   subir, **Then** se rechaza con un mensaje claro antes de consumir almacenamiento.
4. **Given** un participante no involucrado y no administrador, **When** solicita un comprobante
   por cualquier vía, **Then** se deniega (escenario PRD).
5. **Given** un enlace de descarga, **When** pasa su tiempo de validez, **Then** deja de funcionar
   y hay que pedir uno nuevo desde la app.
6. **Given** un pago, **When** el emisor lo registra, **Then** puede adjuntar opcionalmente un
   comprobante visible para emisor, receptor y administradores (RF-21).

---

### User Story 3 - Cuotas de IA y continuidad del registro manual (Priority: P2)

Como administrador técnico, quiero limitar el uso de la IA globalmente y por viaje, y ver métricas
de uso, para controlar el costo sin bloquear a nadie el registro manual.

**Why this priority**: RF-51/HU-16; protege el nivel gratuito del proveedor.

**Independent Test**: con una cuota por viaje de N análisis diarios, el análisis N+1 se rechaza sin
llamar al proveedor y el formulario manual sigue disponible; dos análisis simultáneos al límite no
lo superan.

**Acceptance Scenarios**:

1. **Given** la cuota diaria del viaje agotada, **When** alguien escanea, **Then** se rechaza antes
   de enviar nada al proveedor con el mensaje «cuota de escaneo agotada; puedes registrar a mano».
2. **Given** dos solicitudes simultáneas cuando solo queda una unidad de cuota, **When** llegan,
   **Then** solo una se procesa.
3. **Given** un archivo con más páginas o bytes que el máximo por análisis, **When** se escanea,
   **Then** se rechaza sin costo.
4. **Given** el uso registrado, **When** el administrador técnico consulta métricas, **Then** ve
   análisis, páginas y bytes por día, por viaje, por usuario y por proveedor.
5. **Given** una solicitud repetida con la misma clave por un reintento de red, **When** llega,
   **Then** no consume cuota dos veces.

---

### User Story 4 - Retención de comprobantes a seis meses (Priority: P2)

Como participante, quiero que los comprobantes se borren automáticamente seis meses después de
subirlos, con aviso previo, manteniendo intactos los gastos y su historial.

**Why this priority**: RF-52/RF-53; requisito de privacidad y de costo.

**Independent Test**: un comprobante subido el 31 de marzo vence el 30 de septiembre; antes del
vencimiento el gasto muestra el aviso; tras el proceso programado el archivo no existe, el gasto y
los saldos no cambian y el historial registra el borrado.

**Acceptance Scenarios**:

1. **Given** un comprobante subido en una fecha, **When** se calcula su vencimiento, **Then** es
   seis meses calendario después (fin de mes ajustado al último día válido, en UTC).
2. **Given** un comprobante que vence en los próximos 14 días, **When** alguien que puede ver ese
   gasto abre el gasto o el inicio del viaje, **Then** ve el aviso con la fecha de borrado y puede
   descargarlo antes.
3. **Given** comprobantes vencidos, **When** se ejecuta el proceso programado (una o varias veces),
   **Then** cada archivo se borra exactamente una vez, el registro conserva metadatos y estado
   «borrado» con fecha, y los fallos se reintentan en la siguiente ejecución.
4. **Given** un comprobante borrado por retención, **When** se abre el gasto, **Then** se indica
   «comprobante eliminado por política de retención» y los importes siguen intactos.

---

### Edge Cases

- Foto borrosa o sin texto legible: el borrador llega vacío o con advertencias; el usuario completa
  a mano con la imagen adjunta.
- PDF con 20 páginas: se rechaza si supera el máximo de páginas por análisis; puede adjuntarse sin
  análisis si respeta el tamaño máximo de adjuntos.
- La misma página aparece en dos fotos distintas del mismo análisis: se avisa como posible página
  duplicada.
- La IA devuelve importes negativos, texto en otro idioma o más decimales que la moneda: se
  normalizan o se marcan como dudosos; nunca se guardan sin revisión.
- La IA devuelve una fecha futura o imposible: se marca como dudosa y se propone la fecha de hoy.
- El usuario abandona el borrador: los archivos subidos sin gasto se eliminan en un plazo corto.
- Edición de un gasto con comprobantes: se pueden añadir o quitar comprobantes (autor, creador,
  admin) sin cambiar importes.
- Anulación de un gasto: sus comprobantes se conservan hasta su vencimiento (pueden necesitarse si
  se restaura).
- El proveedor de almacenamiento no está disponible: el gasto se puede guardar sin adjunto y
  reintentar la subida después.
- Cambio de proveedor de IA: los borradores tienen el mismo formato sin cambios en la app.

## Requirements *(mandatory)*

### Functional Requirements

**Adjuntos**

- **FR-001**: Los participantes que pueden ver un gasto MUST poder adjuntarle uno o varios archivos
  (imágenes JPEG/PNG/WebP/HEIC y PDF) al crearlo o después (RF-13, RF-30).
- **FR-002**: Cada archivo MUST respetar un tamaño máximo (10 MB) y, en PDF, un máximo de páginas
  (10); los rechazos ocurren antes de almacenar el archivo.
- **FR-003**: El sistema MUST detectar archivos duplicados en el mismo gasto por su contenido y
  avisar sin guardarlos dos veces.
- **FR-004**: Los comprobantes MUST ser accesibles solo para quienes pueden ver el gasto (RF-38),
  mediante enlaces de descarga temporales (≤ 15 minutos) que nunca son públicos ni permanentes.
- **FR-005**: Autor, creador y administradores MUST poder quitar un comprobante de un gasto
  vigente; quitarlo no altera importes y queda en el historial.
- **FR-006**: El emisor de un pago MUST poder adjuntar un comprobante opcional, visible para emisor,
  receptor y administradores (RF-21).

**Escaneo con IA**

- **FR-007**: El acceso «Escanear factura» MUST estar habilitado en viajes activos y permitir tomar
  una foto con la cámara o elegir imágenes/PDF (RF-25).
- **FR-008**: El análisis MUST realizarse en el servidor mediante un proveedor de IA intercambiable
  sin cambios para la app; el proveedor inicial es Gemini (RF-50).
- **FR-009**: El resultado MUST ser un borrador validado con: comercio, fecha de transacción,
  moneda detectada, ítems (descripción, cantidad, precio unitario, importe), subtotal, impuestos,
  propina, descuentos, total, confianza por campo y advertencias; importes en unidad menor.
- **FR-010**: El borrador MUST abrirse en el formulario de registro de la Fase 2, resaltando campos
  de baja confianza o con advertencias y permitiendo editarlo todo; el guardado MUST seguir
  bloqueado hasta que el gasto cuadre (RF-26).
- **FR-011**: La fecha de transacción detectada MUST usarse como fecha del gasto (editable) y la
  fecha de registro se mantiene aparte (RF-31).
- **FR-012**: Si la moneda detectada difiere de la del viaje, el sistema MUST advertirlo y no
  convertir automáticamente (RF-54).
- **FR-013**: Los archivos analizados MUST quedar vinculados como comprobantes del gasto guardado y
  el gasto MUST registrar su origen («manual» o «escaneado»).
- **FR-014**: Un fallo o indisponibilidad de la IA MUST NOT impedir el registro manual; la foto
  subida se conserva para adjuntarla.
- **FR-015**: Antes de su primer escaneo, cada usuario MUST aceptar explícitamente un aviso claro
  de que las imágenes se envían a un proveedor externo que, en su nivel gratuito, puede usarlas para
  mejorar sus productos; MUST poder revocarlo en cualquier momento; sin consentimiento solo está
  disponible el registro manual (con adjuntos). El consentimiento queda registrado con fecha.

**Cuotas y métricas**

- **FR-016**: El sistema MUST aplicar cuotas combinadas: globales y por viaje (análisis por día y
  por mes), páginas y bytes por análisis y reintentos por archivo, validadas de forma atómica antes
  de llamar al proveedor (RF-51). Límites iniciales (configurables por el administrador técnico):
  20 análisis por viaje al día; 100 globales al día y 1.500 al mes; máximo 5 archivos y 10 páginas
  por análisis; 2 reintentos por archivo.
- **FR-017**: Una solicitud rechazada por cuota MUST NOT generar costo ni llamada al proveedor y MUST
  ofrecer el registro manual.
- **FR-018**: Reintentos con la misma clave MUST NOT consumir cuota dos veces.
- **FR-019**: El sistema MUST registrar métricas de uso (análisis, páginas, bytes, latencia,
  errores) por día, viaje, usuario y proveedor, consultables por el administrador técnico, sin
  guardar contenido de los comprobantes en métricas ni registros.

**Retención**

- **FR-020**: Cada comprobante MUST vencer seis meses calendario después de su carga (UTC; si el
  día no existe en el mes destino, el último día del mes) (RF-53).
- **FR-021**: Un proceso programado e idempotente MUST borrar los comprobantes vencidos, marcar su
  estado y fecha de borrado, reintentar fallos y dejar trazabilidad, sin modificar gastos, pagos ni
  auditoría (RF-52).
- **FR-022**: Quienes pueden ver el gasto MUST ver, desde 14 días antes del vencimiento, un aviso
  en el gasto y en el inicio del viaje con la fecha de borrado y la opción de descargar (nunca se
  avisa a quien no puede ver el gasto).
- **FR-023**: Los archivos subidos para un borrador que nunca se guardó MUST eliminarse en un plazo
  máximo de 24 horas.

### Key Entities

- **Comprobante (adjunto)**: gasto o pago al que pertenece, nombre, tipo, tamaño, páginas, huella
  de contenido, fecha de carga, fecha de vencimiento, estado (vigente, pendiente de vincular,
  borrado), quién lo subió.
- **Análisis de IA**: solicitante, viaje, archivos, proveedor, estado, borrador resultante,
  páginas, bytes, latencia, errores, clave de idempotencia.
- **Borrador de factura**: comercio, fecha, moneda detectada, ítems con confianza, subtotal,
  impuestos, propina, descuentos, total, advertencias.
- **Consentimiento de IA**: usuario, fecha de aceptación, versión del aviso, fecha de revocación.
- **Cuota**: ámbito (global o viaje), periodo (día o mes), consumo de análisis, páginas y bytes,
  límites.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un participante registra una factura de 10 líneas escaneándola y corrigiendo en menos
  de 90 segundos.
- **SC-002**: En un conjunto de prueba de tickets legibles, el borrador cuadra con el total impreso
  en al menos el 80 % de los casos sin corrección de importes.
- **SC-003**: 0 accesos a comprobantes de gastos ajenos por participantes no involucrados en las
  pruebas, y 0 enlaces de descarga utilizables después de su vencimiento.
- **SC-004**: El 100 % de las solicitudes por encima de la cuota se rechazan sin llamada al
  proveedor, incluso con solicitudes simultáneas.
- **SC-005**: El 100 % de los comprobantes vencidos se eliminan en la ejecución programada siguiente
  a su vencimiento y ningún gasto ni saldo cambia por ello.
- **SC-006**: Con la IA no disponible, el 100 % de los intentos de registro manual siguen
  funcionando.

## Assumptions

- Base: 001–003 (privacidad por gasto, formulario de 002, pagos de 003).
- Almacenamiento sin tarjeta según la constitution (Backblaze B2; alternativa Supabase Storage); la
  cuenta del proveedor la crea el responsable del proyecto.
- Quien puede adjuntar o escanear para un gasto existente: quien puede verlo; quitar comprobantes:
  autor, creador y administradores.
- Tamaño máximo 10 MB por archivo, 10 páginas por PDF, hasta 5 archivos por análisis.
- Enlaces de descarga válidos 15 minutos.
- La interfaz del administrador técnico para métricas es una consulta protegida (sin panel visual
  en esta fase).
- Los comprobantes de gastos anulados se conservan hasta su vencimiento.
- Las notificaciones push/email del vencimiento llegan en la Fase 5; en esta fase el aviso es
  visible dentro de la app.
