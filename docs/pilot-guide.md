# Guía de pruebas con usuarios (piloto)

**Objetivo**: comprobar con un grupo real que la app permite registrar y repartir los gastos de un viaje sin errores y
sin ayuda, y recoger fricciones antes de abrirla a más gente.

**Participantes**: 2–3 grupos de 3–6 personas que viajen juntas, con al menos un Android y un iPhone por grupo.

**Duración**: un viaje real (2–7 días) y una sesión de 30 min al final.

## Preparación

1. Crea los viajes con el organizador de cada grupo, que será el creador.
2. Comparte el enlace `https://<proyecto>.web.app` y el aviso de privacidad (abajo).
3. Durante el viaje no intervengas salvo bloqueo. Anota cada vez que alguien pida ayuda.

## Tareas

Cada tarea se observa o se pregunta al final del viaje.

| # | Tarea | Éxito | Métrica |
|---|---|---|---|
| 1 | Instalar la app en el móvil (Android: «Instalar»; iPhone: Compartir → «Añadir a pantalla de inicio») | Se abre desde el icono a pantalla completa | % que lo logra sin ayuda |
| 2 | Aceptar la invitación al viaje | Aparece en «Mis viajes» | Tiempo desde el enlace |
| 3 | Registrar un gasto simple pagado por ti y repartido entre todos | Aparece en saldos | Tiempo (objetivo ≤ 60 s) |
| 4 | Escanear una factura con varios ítems y corregir lo que la IA leyó mal | El gasto cuadra con la factura | Nº de correcciones y lecturas erróneas por campo |
| 5 | Registrar un gasto sin conexión (modo avión) y comprobar que se envía al volver | Llega una sola vez | Gastos duplicados (objetivo 0) |
| 6 | Registrar un gasto personal de otra persona (pagas tú, consume otro) | Esa persona te debe el importe | Comprensión de «personal» |
| 7 | Saldar una deuda: registrar el pago y que el receptor lo confirme | El saldo baja a 0 | Pagos rechazados por error |
| 8 | Exportar el viaje a Excel y PDF al terminar | Los totales coinciden con la app | Diferencias (objetivo 0) |
| 9 | (Voluntario, cuenta de prueba) Borrar la cuenta | El resto ve «Participante eliminado» y los saldos no cambian | Comprensión del aviso |

## Métricas del piloto

- **Exactitud**: diferencias entre exportaciones y saldos de la app. Objetivo: 0 céntimos.
- **Autonomía**: peticiones de ayuda por persona y día.
- **Tiempos**: registro manual ≤ 60 s y escaneo con corrección ≤ 2 min.
- **IA**: porcentaje de facturas que se guardan sin corregir el total.
- **Operación**:
  - alertas de uptime durante el piloto;
  - consumo diario máximo frente a los límites (`docs/operations.md`);
  - errores 5xx en Workers Observability.
- **Satisfacción**: «¿Usarías la app en tu próximo viaje?» (1–5) y «¿Qué te frustró?» (abierta).

## Formulario de hallazgos

Copia una fila por hallazgo en la hoja del piloto.

| Campo | Contenido |
|---|---|
| Fecha y grupo | |
| Dispositivo y navegador | p. ej. iPhone 13 · Safari 18 / PWA instalada |
| Tarea (#) | |
| Qué pasó | Hechos, sin interpretar |
| Qué esperaba la persona | |
| Identificador del error | `x-correlation-id` si hubo mensaje de error (DevTools o captura) |
| Gravedad | Bloqueante · Grave (dato incorrecto o pérdida) · Molesta · Cosmética |
| Frecuencia | 1 vez · varias · siempre |

Los bloqueantes y graves se revisan en 24 h; el resto se priorizan al cierre del piloto.

## Privacidad (enviar a los participantes)

- Tu nombre, correo y foto de Google se usan solo para identificarte ante tu grupo. El detalle de un gasto lo ven
  quienes participan en él y los administradores del viaje; los saldos los ve todo el grupo.
- **Escaneo con IA**: las facturas se envían a OpenAI. No las usa para entrenar sus modelos, pero puede conservarlas
  hasta 30 días para detectar abusos. Si no quieres, registra los gastos a mano.
- Los comprobantes se borran a los **6 meses**.
- Puedes **borrar tu cuenta** desde el menú de tu cuenta.
  - Se eliminan tu nombre, tu correo, tu foto, tus notificaciones y tus comprobantes personales.
  - En los viajes quedarás como «Participante eliminado» para que las cuentas del grupo sigan cuadrando.
  - Las descripciones de gastos que escribiste se conservan porque son parte del registro del grupo.
- Las copias de seguridad cifradas se conservan como máximo **35 días**.
- En viajes de muy pocas personas, los saldos (que ve todo el grupo) pueden dejar deducir importes de gastos privados.
