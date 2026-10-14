# Feature Specification: Hardening y piloto (Fase 6)

**Feature Branch**: `006-hardening-pilot`

**Created**: 2026-10-14

**Status**: Draft

**Input**: User description: "Fase 6 del PRD: Hardening y piloto. Construye sobre 001-005. Incluye: (a) RF-56 baja y
anonimización de cuenta preservando la integridad financiera (Σsaldos=0, pagos y devoluciones intactos), reglas para
creador único, deudas y pagos por confirmar, auditoría sin PII, política de borrado de comprobantes (PRD #2);
(b) despliegue reproducible a producción (Hosting, reglas, índices, Worker con secretos y cron, B2, Gemini) con smoke
test; (c) backups y recuperación de Firestore sin Blaze; (d) monitoreo: health check, logs sin PII, alertas gratuitas,
documento de costos y límites; (e) hardening: cabeceras, CSP, rate limiting, WCAG AA, Lighthouse, rendimiento;
(f) piloto: checklist de lanzamiento y guía de pruebas (PRD §15). Fuera de alcance: nuevas funcionalidades de
producto, push/email, planes de pago."

PRD cubierto: RF-56, §12 (estrategia de pruebas: seguridad, accesibilidad, rendimiento), §13 fase 6, §14 #2 y #7,
§15 (definición de terminado del MVP).

## Clarifications

### Session 2026-10-14

- Q: ¿Qué pasa con los comprobantes del usuario que se da de baja (PRD #2)? → A: se borran de inmediato los de gastos
  que solo él podía ver y sus borradores; los de gastos compartidos y de pagos se conservan para el grupo hasta su
  vencimiento normal de 6 meses, sin identificar al autor.
- Q: ¿Qué impide la baja y cómo se liquidan después las deudas con un participante eliminado? → A: bloquean solo los
  pagos pendientes de confirmar; los saldos no bloquean (se advierten) y después el creador o un administrador
  registra o confirma pagos en lugar del participante eliminado.
- Q: ¿Qué pasa con los viajes en los que el usuario es creador? → A: el rol pasa automáticamente al administrador más
  antiguo o, si no hay, al participante aceptado más antiguo; sin otros participantes, el viaje queda anonimizado.
- Q: ¿Frecuencia y retención de las copias de seguridad? → A: diaria, cifrada, con 7 copias diarias y 4 semanales
  (máximo ~35 días); pérdida máxima 24 h.
- Q: ¿Límites de frecuencia de la API? → A: 120 peticiones por minuto por usuario autenticado y 60 por minuto por
  dirección de red en rutas públicas; las cuotas de IA siguen aparte.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Darse de baja sin romper las cuentas del grupo (Priority: P1)

Pedro ya no quiere usar la app y pide borrar su cuenta. Sus datos personales desaparecen (nombre, correo, foto, sus
notificaciones, sus comprobantes privados) y deja de poder entrar. En los viajes en los que participó aparece como
«Participante eliminado», y los saldos de Ana y Juan siguen exactamente igual: lo que Pedro pagó, consumió y liquidó
sigue contando.

**Why this priority**: RF-56 es el único requisito funcional del PRD sin implementar y una condición del MVP (§15:
«se verifica la anonimización de cuenta»). Es también una obligación legal básica de protección de datos.

**Independent Test**: en un viaje con tres participantes, varios gastos, un pago confirmado y una devolución, Pedro
borra su cuenta; los saldos de todos (incluido el del participante eliminado) son idénticos antes y después, la suma
sigue siendo cero, y en ningún documento accesible queda su nombre ni su correo.

**Acceptance Scenarios**:

1. **Given** Pedro con sesión iniciada, **When** abre «Borrar mi cuenta», **Then** ve un resumen de las consecuencias
   (viajes afectados, saldos pendientes por viaje, comprobantes que se borrarán, viajes en los que es creador y a quién
   pasará ese rol) y debe confirmar escribiendo una palabra de confirmación.
2. **Given** Pedro tiene pagos pendientes de confirmar (como emisor o receptor), **When** intenta borrar la cuenta,
   **Then** se le indica cuáles son y no puede continuar hasta resolverlos o cancelarlos.
3. **Given** Pedro confirma la baja, **When** termina el proceso, **Then** su sesión se cierra, su cuenta de acceso deja
   de existir, y en cada viaje figura como «Participante eliminado N» con el mismo saldo que tenía; Σ saldos = 0.
4. **Given** Pedro era creador de un viaje con otros participantes, **When** se da de baja, **Then** el rol de creador
   pasa automáticamente al administrador más antiguo o, si no hay, al participante más antiguo, y queda registrado
   en la auditoría.
5. **Given** un viaje en el que el participante eliminado tenía deuda o crédito, **When** otro participante registra
   un pago con él, **Then** el creador o un administrador puede confirmar o registrar ese pago en su lugar, y los
   saldos se liquidan normalmente.
6. **Given** la baja completada, **When** Pedro vuelve a entrar con la misma cuenta de Google, **Then** empieza como un
   usuario nuevo sin acceso a sus viajes anteriores.

---

### User Story 2 - Publicar la app en producción de forma repetible (Priority: P1)

Paul (operador) quiere publicar la app y la API en producción con un solo procedimiento documentado, sin pasos
manuales olvidados y con una comprobación automática de que todo responde bien después de cada publicación.

**Why this priority**: sin despliegue no hay piloto; los fallos de configuración (orígenes, secretos, índices) son la
causa más común de caídas en el primer día.

**Independent Test**: siguiendo la guía de despliegue en un proyecto nuevo, la verificación posterior pasa (la app
carga, inicia sesión, la API responde, las cabeceras de seguridad están presentes) y una configuración incompleta
(un valor de ejemplo sin reemplazar o un secreto faltante) se detecta antes de publicar.

**Acceptance Scenarios**:

1. **Given** la configuración de producción completa, **When** el operador ejecuta el despliegue, **Then** se publican
   la app, las reglas, los índices y la API, y se ejecuta una verificación posterior que informa éxito o el paso que
   falló.
2. **Given** una configuración con valores de ejemplo o secretos faltantes, **When** el operador intenta desplegar,
   **Then** el proceso se detiene antes de publicar indicando qué falta.
3. **Given** un despliegue fallido, **When** el operador sigue la guía, **Then** puede volver a la versión anterior.

---

### User Story 3 - Recuperar los datos tras un desastre (Priority: P1)

Si un error borra o corrompe datos, Paul debe poder restaurar el estado de la base de datos de un momento reciente,
sabiendo cuánto se perdería como máximo.

**Why this priority**: los datos financieros de los grupos son irrecuperables por otro medio; §15 exige backups y
recuperación documentados. El plan gratuito no ofrece copias gestionadas.

**Independent Test**: se genera una copia, se borra un entorno de prueba, se restaura la copia y los saldos y el número
de documentos coinciden exactamente con el origen.

**Acceptance Scenarios**:

1. **Given** el sistema en producción, **When** pasa un día, **Then** existe una copia completa nueva, cifrada, en un
   almacenamiento privado distinto de la base de datos, y se conservan las copias de los últimos 7 días y de las
   últimas 4 semanas.
2. **Given** una copia, **When** el operador sigue el procedimiento de restauración en un entorno vacío, **Then** el
   contenido restaurado es idéntico al de la copia (mismos documentos y saldos).
3. **Given** una copia que no se generó o que falló, **When** ocurre, **Then** el operador recibe una alerta.

---

### User Story 4 - Saber si la app está funcionando (Priority: P2)

Paul quiere enterarse de una caída o de un consumo cercano a los límites gratuitos antes que los usuarios, y poder
investigar un error a partir del identificador que ve un usuario, sin ver datos personales en los registros.

**Why this priority**: con planes gratuitos, superar una cuota deja la app sin servicio hasta el día siguiente.

**Independent Test**: se detiene la API; en menos de 30 minutos llega una alerta. Un error reportado por un usuario
con su identificador de petición se encuentra en los registros sin nombres, correos ni importes de ítems.

**Acceptance Scenarios**:

1. **Given** la API caída o respondiendo errores, **When** falla la comprobación periódica, **Then** el operador recibe
   una alerta en menos de 30 minutos.
2. **Given** un error mostrado a un usuario, **When** el operador busca su identificador, **Then** encuentra la entrada
   del registro con el tipo de error, la ruta y la duración, y sin datos personales.
3. **Given** el documento de costos, **When** el operador lo consulta, **Then** conoce los límites de cada servicio
   gratuito, el consumo estimado por usuario activo y qué hacer al acercarse a cada límite.

---

### User Story 5 - App segura, accesible y rápida para el piloto (Priority: P2)

Antes de invitar a los usuarios del piloto, la app debe superar una revisión de seguridad, accesibilidad y rendimiento,
y el equipo debe tener una lista de lanzamiento y una guía para las pruebas con usuarios.

**Why this priority**: §12 y §15 del PRD; un piloto con fallos de accesibilidad o seguridad invalida sus resultados.

**Independent Test**: las comprobaciones automáticas de accesibilidad no encuentran fallos graves en las pantallas
principales; la auditoría de calidad del navegador supera los umbrales; un cliente que abusa de la API es frenado.

**Acceptance Scenarios**:

1. **Given** las pantallas principales (entrada, lista de viajes, detalle, nuevo gasto, saldos, pagos, notificaciones,
   pendientes, cuenta), **When** se auditan, **Then** no hay infracciones graves o críticas de WCAG 2.1 AA.
2. **Given** la app publicada, **When** se audita con la herramienta de calidad del navegador en móvil, **Then** obtiene
   al menos 90 en accesibilidad y buenas prácticas y al menos 80 en rendimiento, y supera la comprobación de
   instalabilidad.
3. **Given** un cliente que envía peticiones en ráfaga, **When** supera el límite por usuario, **Then** recibe un error
   de «demasiadas peticiones» con tiempo de espera, y los demás usuarios no se ven afectados.
4. **Given** la app publicada, **When** se inspeccionan sus respuestas, **Then** incluye una política de contenido que
   solo permite cargar recursos de orígenes propios y de los servicios usados, y cabeceras que impiden incrustarla
   en otros sitios.
5. **Given** la lista de lanzamiento, **When** se completa, **Then** cada condición del §15 del PRD tiene una evidencia
   (prueba automática, medición o verificación manual firmada).

---

### Edge Cases

- Baja con la sesión iniciada en otros dispositivos: esos dispositivos pierden acceso en cuanto intentan cualquier
  operación y borran sus datos locales (caché y pendientes) al detectarlo.
- Baja con gastos pendientes de sincronizar en el dispositivo: se advierte de que se descartarán.
- Baja interrumpida a mitad (error o corte): el proceso es reanudable y repetible; nunca queda un viaje con la mitad
  de los datos anonimizados; volver a pedirlo continúa donde quedó.
- El participante eliminado era el único miembro aceptado de un viaje: el viaje queda inaccesible para todos (nadie
  más lo veía) y conserva sus datos financieros anónimos.
- El participante eliminado tenía invitaciones pendientes recibidas: se eliminan como rechazadas. Invitaciones que
  envió y siguen pendientes: siguen vigentes, mostrando el viaje sin el nombre del invitador.
- Notificaciones de otras personas que mencionan al usuario eliminado: dejan de mostrar su nombre.
- Comprobantes subidos por el usuario en gastos compartidos: se conservan para el resto del grupo hasta su vencimiento
  normal de 6 meses, sin datos que lo identifiquen como autor.
- Viaje cerrado o archivado con el usuario: se anonimiza igual (la baja no requiere reabrirlo).
- Dos participantes eliminados en el mismo viaje: cada uno tiene una etiqueta distinta y estable («Participante
  eliminado 1», «… 2»).
- Una copia de seguridad contiene datos de un usuario que después se dio de baja: las copias caducan en ≤ 35 días; al
  restaurar una copia, el procedimiento vuelve a aplicar las bajas registradas posteriores.
- Superado el límite diario de un servicio gratuito: la app muestra un mensaje claro de servicio temporalmente no
  disponible, sin perder datos; los pendientes offline se reintentan después.
- Despliegue con la API y la app en versiones incompatibles: la verificación posterior lo detecta.

## Requirements *(mandatory)*

### Functional Requirements

**Baja y anonimización (RF-56)**

- **FR-001**: Un usuario MUST poder solicitar la baja de su cuenta desde la app. Antes de confirmar MUST ver qué
  viajes se ven afectados, su saldo en cada uno, qué comprobantes se borrarán y a quién pasará el rol de creador.
- **FR-002**: La baja MUST requerir confirmación explícita (escribir una palabra) y un inicio de sesión reciente (en
  los últimos 5 minutos); si no es reciente, se pide volver a iniciar sesión.
- **FR-003**: La baja MUST bloquearse mientras el usuario tenga pagos pendientes de confirmar como emisor o receptor,
  indicando cuáles. Los saldos distintos de cero NO bloquean la baja, pero se advierten.
- **FR-004**: Al completarse la baja, el sistema MUST eliminar: la cuenta de acceso, el perfil (nombre, correo, foto),
  sus índices de viajes, sus notificaciones, sus invitaciones recibidas pendientes, sus borradores de escaneo y
  cargas sin terminar, y los comprobantes de gastos que solo él podía ver (gastos personales en los que es el único
  pagador y beneficiario).
- **FR-005**: En cada viaje, el participante MUST quedar como identidad anónima estable («Participante eliminado N»,
  N único por viaje) sin nombre, correo ni foto; sus gastos, ítems, repartos, pagos, devoluciones y saldos MUST
  conservarse sin cambios, de modo que los saldos de todos y Σ saldos = 0 sean idénticos antes y después.
- **FR-006**: Los comprobantes que el usuario subió en gastos que otros pueden ver y los comprobantes de pagos MUST
  conservarse hasta su vencimiento normal (6 meses), sin dato que identifique al autor más allá de la etiqueta anónima.
- **FR-007**: Si el usuario es creador de un viaje con otros participantes aceptados, el rol de creador MUST pasar al
  administrador con mayor antigüedad o, si no hay, al participante aceptado con mayor antigüedad; queda en auditoría.
- **FR-008**: Las notificaciones de otros usuarios, las invitaciones enviadas por el usuario y los textos de auditoría
  MUST dejar de contener su nombre o correo; la auditoría registra la baja sin datos personales.
- **FR-009**: Un participante eliminado MUST dejar de recibir pagos o notificaciones como persona activa. Los pagos en
  los que la otra parte es un participante eliminado MUST poder registrarse y confirmarse por el creador o un
  administrador del viaje en su lugar, con las mismas reglas de inmutabilidad.
- **FR-010**: El proceso de baja MUST ser idempotente y reanudable: repetirlo tras un fallo completa lo pendiente sin
  duplicar etiquetas ni alterar saldos.
- **FR-011**: El cliente MUST borrar los datos locales (caché, pendientes) al completar la baja o al detectar que la
  cuenta ya no existe.
- **FR-012**: Si la misma cuenta de Google vuelve a entrar, MUST tratarse como un usuario nuevo sin acceso a viajes
  anteriores.

**Despliegue reproducible**

- **FR-013**: MUST existir un procedimiento de despliegue documentado y automatizado que publique la app, las reglas
  e índices de la base de datos y la API (con sus secretos y tareas programadas) en un entorno de producción.
- **FR-014**: Antes de publicar, el procedimiento MUST verificar que no quedan valores de ejemplo en la configuración y
  que existen todos los secretos requeridos; si falta algo, MUST detenerse sin publicar.
- **FR-015**: Tras publicar, MUST ejecutarse una verificación automática (smoke test) que compruebe: la app carga, la
  API responde a la comprobación de salud con su versión, la API acepta el origen de la app y rechaza otros, las
  cabeceras de seguridad están presentes y la app y la API son de versiones compatibles.
- **FR-016**: La guía MUST incluir la vuelta atrás a la versión anterior de app y API.

**Backups y recuperación**

- **FR-017**: MUST generarse diariamente una copia completa de la base de datos, cifrada, en un almacenamiento privado
  distinto de la base de datos y de los comprobantes, sin coste ni tarjeta.
- **FR-018**: MUST conservarse las copias diarias de los últimos 7 días y una semanal de las últimas 4 semanas; las
  más antiguas MUST eliminarse.
- **FR-019**: MUST existir un procedimiento de restauración documentado y una prueba automática que restaure una copia
  en un entorno vacío y verifique que documentos y saldos coinciden con el origen.
- **FR-020**: Al restaurar una copia, el procedimiento MUST volver a aplicar las bajas de cuenta registradas después
  de la fecha de la copia.
- **FR-021**: El fallo de una copia MUST generar una alerta al operador.

**Monitoreo y operación**

- **FR-022**: La API MUST exponer una comprobación de salud pública que indique versión y entorno y si puede acceder a
  la base de datos, sin datos de usuarios.
- **FR-023**: Una comprobación periódica (al menos cada 15 minutos) MUST alertar al operador si la app o la API no
  responden correctamente.
- **FR-024**: Cada petición a la API MUST registrar una línea estructurada con identificador de correlación, ruta
  normalizada (sin identificadores de usuario), estado, código de error y duración, sin datos personales.
- **FR-025**: MUST existir un documento de operación con los límites de cada servicio gratuito, el consumo estimado
  por usuario activo y por viaje, los umbrales de aviso y las acciones a tomar.

**Hardening**

- **FR-026**: La app publicada MUST enviar una política de seguridad de contenido restrictiva (solo orígenes propios y
  de los servicios usados), prohibir ser incrustada, y forzar conexiones seguras.
- **FR-027**: La API MUST limitar la frecuencia de peticiones por usuario autenticado y, en rutas sin autenticar, por
  origen de red (120 por minuto por usuario; 60 por minuto por dirección en rutas públicas), respondiendo «demasiadas
  peticiones» con tiempo de espera. Las operaciones de IA conservan sus cuotas.
- **FR-028**: Las pantallas principales MUST cumplir WCAG 2.1 AA, verificado con pruebas automáticas en cada cambio.
- **FR-029**: La app publicada MUST alcanzar los umbrales de calidad del navegador definidos en SC-007.
- **FR-030**: MUST realizarse y registrarse una revisión de seguridad de autorización, reglas de acceso, archivos,
  exportaciones y la nueva baja de cuenta, con sus hallazgos resueltos o aceptados.
- **FR-031**: Cuando un servicio gratuito agote su cuota, la app MUST mostrar un mensaje de servicio temporalmente no
  disponible y conservar lo que el usuario estaba haciendo.

**Piloto**

- **FR-032**: MUST existir una lista de lanzamiento que mapee cada condición del §15 del PRD a su evidencia.
- **FR-033**: MUST existir una guía de pruebas con usuarios con tareas, métricas a observar y un formulario de
  hallazgos.

### Key Entities

- **Solicitud de baja**: usuario, fecha de solicitud, fase alcanzada (pendiente, en curso, completada), viajes
  procesados; permite reanudar y queda como registro sin datos personales.
- **Participante eliminado**: miembro de un viaje anonimizado; conserva su identificador interno opaco, su rol
  financiero y su orden de entrada; tiene una etiqueta estable por viaje.
- **Registro de bajas**: lista de identificadores opacos dados de baja con su fecha, usada para volver a aplicarlas al
  restaurar una copia.
- **Copia de seguridad**: fecha, tipo (diaria/semanal), tamaño, número de documentos, huella de integridad; cifrada.
- **Comprobación de salud**: versión, entorno, estado de la base de datos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Tras una baja, el 100 % de los saldos de cada viaje afectado son idénticos al centavo a los de antes, y
  Σ saldos = 0 (verificado con viajes que incluyen gastos, ítems, pagos confirmados y devoluciones).
- **SC-002**: Tras una baja, 0 apariciones del nombre o correo del usuario en cualquier documento de la base de datos
  activa (verificado por búsqueda exhaustiva en pruebas).
- **SC-003**: Una baja de un usuario con 10 viajes se completa en menos de 1 minuto.
- **SC-004**: Un despliegue completo con verificación termina en menos de 15 minutos y una configuración incompleta se
  detecta el 100 % de las veces antes de publicar.
- **SC-005**: Pérdida máxima de datos ante desastre ≤ 24 horas; restauración completa de una copia en menos de 1 hora.
  La prueba de restauración reproduce el 100 % de los documentos.
- **SC-006**: Una caída de la API se notifica al operador en menos de 30 minutos.
- **SC-007**: En móvil, la app obtiene ≥ 90 en accesibilidad y buenas prácticas y ≥ 80 en rendimiento en la auditoría
  de calidad del navegador, y supera la comprobación de instalabilidad (manifiesto, iconos y funcionamiento offline).
- **SC-008**: 0 infracciones graves o críticas de accesibilidad en las pantallas principales.
- **SC-009**: 0 apariciones de correos, nombres o importes de ítems en los registros de la API en las pruebas.
- **SC-010**: Con 20 usuarios activos del piloto, el consumo diario estimado queda por debajo del 50 % de cada límite
  gratuito.
- **SC-011**: Cada condición del §15 del PRD tiene evidencia en la lista de lanzamiento.

## Assumptions

- La anonimización conserva el identificador interno opaco del participante en los datos financieros: tras borrar la
  cuenta de acceso y el perfil, ese identificador no permite identificar a la persona. Las descripciones de gastos y
  notas escritas libremente por el usuario son registros financieros compartidos y se conservan.
- La baja es inmediata (sin periodo de gracia ni cancelación posterior), con confirmación explícita.
- Las copias de seguridad contienen datos personales y caducan como máximo a los 35 días; esa ventana se documenta en
  la política de privacidad del piloto.
- Las alertas usan canales gratuitos ya disponibles para el operador (notificaciones del repositorio de código o del
  proveedor de la API); no hay servicio de guardia.
- El despliegue real en las cuentas del operador (proyecto Firebase, cuenta de Cloudflare, bucket, clave de IA) lo
  ejecuta el operador siguiendo la guía; esta fase entrega la automatización, la verificación y la documentación.
- Un solo entorno de producción para el piloto, más el entorno local con emuladores; sin entorno intermedio.
- Piloto con hasta ~20 usuarios y ~10 viajes activos.
- PRD #7 (inferencia por agregados en viajes muy pequeños) se acepta y documenta como riesgo conocido del piloto:
  los saldos son públicos dentro del viaje por diseño (RF-39).
