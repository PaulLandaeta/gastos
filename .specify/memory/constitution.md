<!--
Sync Impact Report
- Version change: 1.0.0 → 1.0.1 (PATCH: Principio I admite desempate rotativo determinista,
  decidido en /speckit-clarify de 001-finance-engine-trips)
- Versión anterior: (plantilla) → 1.0.0
- Principios definidos: I–VIII (nuevos)
- Secciones añadidas: Restricciones Tecnológicas y de Infraestructura; Flujo de Desarrollo y
  Quality Gates; Decisiones Pendientes Registradas; Governance
- Secciones eliminadas: ninguna
- Templates:
  ✅ .specify/templates/plan-template.md (Constitution Check se deriva de este archivo; sin cambios)
  ✅ .specify/templates/tasks-template.md (tests pasan de OPCIONALES a OBLIGATORIOS según Principio V)
  ✅ .specify/templates/spec-template.md (sin cambios requeridos)
- TODOs diferidos: ver "Decisiones Pendientes Registradas"
-->

# Gastos de Viaje Colaborativos Constitution

## Core Principles

### I. Integridad Financiera (NO NEGOCIABLE)

- Todo importe persistido, transmitido o calculado MUST ser un entero en la unidad menor de la
  moneda del viaje (catálogo ISO 4217 para decimales). Está prohibido usar `float`/`number`
  decimal para contabilidad; los porcentajes y cantidades fraccionarias se representan como
  racionales (numerador/denominador).
- Invariantes obligatorias por gasto vigente: `Σ aportes de pagadores = total =
  Σ cargos netos asignados`; en facturas mixtas `total = Σ personales + Σ compartidos`.
  Invariante por viaje: `Σ saldos = 0`. La vista simplificada MUST preservar el saldo neto de
  cada participante.
- El redondeo MUST ser determinista (RF-43): cuotas racionales → truncar → ordenar residuos
  descendentes → distribuir unidades; los empates se resuelven con una regla determinista
  documentada en la spec (actualmente: rotación por número de secuencia inmutable del gasto
  sobre el orden de entrada al viaje). El orden visual nunca altera resultados.
- La lógica financiera vive en `packages/finance-engine`: TypeScript puro, sin I/O, sin
  dependencias de Firebase, cubierto por tests unitarios y de propiedades (fast-check).
- Los saldos se derivan de gastos, devoluciones y pagos confirmados; los snapshots son
  proyecciones reconstruibles, nunca fuente de verdad.

**Rationale:** un error de un centavo destruye la confianza del grupo; la exactitud debe ser
verificable automáticamente.

### II. Privacidad y Seguridad Deny-by-Default

- Firestore Security Rules MUST denegar todo por defecto y abrir solo lecturas explícitamente
  autorizadas por membresía y rol.
- RF-38/RF-39: un participante normal ve el detalle (ítems, adjuntos) solo de gastos donde es
  pagador o beneficiario; admin/creador ve todo. Todos ven el grafo de deudas y agregados
  autorizados. Como las Rules no filtran campos, los datos privados MUST almacenarse en
  documentos separados de los agregados públicos.
- La misma regla de privacidad MUST aplicarse en cuatro capas: Rules, API (Workers),
  almacenamiento de archivos y exportaciones/notificaciones.
- Los comprobantes residen en buckets privados; el acceso es solo mediante URLs firmadas de
  corta duración emitidas por el backend tras autorizar.
- Los logs MUST ser estructurados, con correlation ID y sin PII, importes por ítem ni contenido
  de recibos. Los secretos viven solo en Secrets de Cloudflare / variables de entorno, nunca en
  el cliente ni en el repositorio.

**Rationale:** el riesgo principal del producto es la fuga de detalle privado por canales
laterales (búsquedas, agregados, exports).

### III. Escrituras Críticas Solo en Servidor

- Toda operación que afecte balances, gastos, pagos, devoluciones, roles, invitaciones, estado
  del viaje, cuotas IA, anonimización o exportaciones MUST ejecutarse en el backend
  (Cloudflare Workers). El cliente no escribe datos financieros directamente en Firestore.
- El backend MUST verificar el Firebase ID token en cada request (firma contra JWKS de Google,
  `aud`/`iss`/`exp`) y re-validar membresía, rol y estado del viaje dentro de la misma
  transacción Firestore (REST `beginTransaction`/`commit`) en que escribe.
- Estado del viaje: `pending → active → closed ⇄ active`, `archived` restaura el estado previo.
  Tras el primer gasto, `participantsLocked` y `currencyLocked` son permanentes (aun si se anula).
- Códigos de error de dominio estables y tipados (p. ej. `TRIP_NOT_READY`, `CONFLICT`,
  `FORBIDDEN`, `QUOTA_EXCEEDED`) definidos en `packages/contracts`.

**Rationale:** Spark no permite Cloud Functions; Workers cumple el rol de backend confiable
sin requerir tarjeta.

### IV. Auditable, Versionado e Idempotente

- Toda entidad mutable lleva `version` y `schemaVersion`. Las escrituras MUST enviar
  `expectedVersion`; si difiere se responde `CONFLICT` con diferencias, nunca se sobrescribe.
- Toda creación desde el cliente (incluida la cola offline) MUST llevar `idempotencyKey`;
  reintentos con la misma clave producen exactamente un efecto.
- Borrado siempre lógico (soft delete) con restauración; no hay borrado definitivo de viajes.
  Los pagos confirmados son inmutables: correcciones solo por movimientos compensatorios.
- Cada mutación registra un `auditEvent` (actor, momento, acción, entidad, versión previa/nueva,
  diff redactado). Ediciones que alteren deudas tras pagos confirmados MUST mostrar vista previa
  de impacto y pedir confirmación.

### V. Test-First (NO NEGOCIABLE)

- TDD obligatorio: tests escritos → fallan → implementación → refactor.
- Los 6 escenarios Gherkin críticos del PRD (§6.1) y la estrategia de pruebas (§12) son tests
  obligatorios en CI.
- Herramientas: Vitest (unit/integración), fast-check (propiedades), Firebase Emulator Suite
  (Auth + Firestore + Rules), `wrangler dev`/Miniflare (Workers), Playwright (E2E y PWA).
- Cada regla de privacidad tiene al menos un test negativo (usuario no involucrado es denegado).
- No se fusiona código con tests rojos ni con cobertura del motor financiero < 95% de líneas.

### VI. Free-Tier First y Proveedores Intercambiables

- Solo se usan servicios utilizables sin tarjeta de crédito: Firebase Spark (Auth, Firestore,
  Hosting), Cloudflare Workers Free, Backblaze B2 (10 GB) y Gemini API free tier.
- Dependencias externas variables MUST estar detrás de interfaces en `packages/contracts`:
  `ReceiptAIProvider` (Gemini inicial, OpenAI futuro) y `ReceiptStorageProvider`
  (Backblaze B2 inicial, Supabase Storage como alternativa).
- Las cuotas IA (globales y por viaje, tamaño, páginas, reintentos) MUST validarse de forma
  atómica antes de llamar al proveedor (RF-51). Una caída o agotamiento de IA nunca impide el
  registro manual.
- Cada feature MUST estimar su consumo frente a los límites gratuitos (lecturas/escrituras
  Firestore por día, requests Workers por día, GB de almacenamiento) en su `plan.md`.

### VII. PWA Mobile-First, Offline Básico y Accesible

- React PWA instalable (manifest + service worker), diseñada primero para Chrome Android y
  Safari iOS recientes, con degradación elegante de cámara, instalación y offline.
- Offline: consulta de caché y creación de gastos manuales encolados en IndexedDB con UUID y
  versión conocida; sincronización única, pendientes visibles y conflictos explícitos.
- Accesibilidad WCAG 2.1 AA: navegación por teclado, labels, contraste y errores claros.
- Cada paso de captura muestra moneda y total; las discrepancias y los ítems sin beneficiario
  son visibles; las acciones con impacto financiero piden confirmación.

### VIII. Simplicidad y Alcance Disciplinado

- YAGNI: solo se implementa lo que exige un RF del PRD. Las exclusiones del PRD §2
  (presupuestos, conversión de divisas, pagos bancarios, push/email, cuentas anónimas,
  pagadores externos, apps nativas, prorrateo diario, aprobaciones por gasto/asignación,
  borrado definitivo de viajes) están prohibidas salvo enmienda.
- Una sola moneda por viaje; sin conversión automática (RF-08, RF-54).
- Toda complejidad adicional (nuevo paquete, nuevo servicio externo, patrón no trivial) MUST
  justificarse en la tabla "Complexity Tracking" del plan.

## Restricciones Tecnológicas y de Infraestructura

| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript (strict) + Vite, React Router, TanStack Query, React Hook Form + Zod, vite-plugin-pwa, IndexedDB |
| Auth | Firebase Authentication — proveedor Google, email verificado |
| Base de datos | Cloud Firestore (plan Spark: 1 GiB, 50k lecturas / 20k escrituras / 20k borrados por día) |
| Backend | Cloudflare Workers (TypeScript), Firestore vía REST con service account, `jose` para JWT, Cron Triggers para jobs (retención 6 meses, cuotas, anonimización) |
| Archivos | Backblaze B2 vía API S3 (presigned URLs, bucket privado); alternativa Supabase Storage |
| IA | Gemini API (Google AI Studio) vía `ReceiptAIProvider`, salida validada con Zod |
| Hosting | Firebase Hosting (SPA + HTTPS) |
| Tooling | pnpm workspaces, ESLint, Prettier, Vitest, fast-check, Playwright, Firebase Emulator Suite, Wrangler |

Estructura de repositorio (monorepo):

```text
apps/web/                 # React PWA
apps/api/                 # Cloudflare Worker (API + cron)
packages/finance-engine/  # motor financiero puro
packages/contracts/       # tipos, esquemas Zod, códigos de error, interfaces de proveedores
firebase/                 # firestore.rules, índices, configuración de emuladores
```

- Esquemas Zod compartidos son la fuente única de contratos entre web y API.
- Retención: adjuntos se eliminan a los 6 meses calendario (UTC) desde la carga, con aviso
  previo; los datos financieros y la auditoría se conservan (RF-52/53).

## Flujo de Desarrollo y Quality Gates

- Ciclo SDD obligatorio por feature: `/speckit-specify` → `/speckit-clarify` →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`.
- Cada `spec.md` referencia los RF/HU del PRD que cubre; cada `plan.md` incluye Constitution
  Check contra los principios I–VIII y estimación de consumo free tier.
- Gates de merge: lint + typecheck + tests (unit, rules en emulador, Workers) en verde;
  `/security-review` en cambios que toquen Rules, autorización, archivos o exports.
- Commits pequeños y descriptivos; nunca incluir trailers de co-autoría de IA.
- Orden de fases según PRD §13: 0 Cimientos → 1 Identidad y viajes → 2 Gastos y balances →
  3 Liquidaciones y cambios → 4 IA y adjuntos → 5 PWA y colaboración → 6 Hardening.

## Decisiones Pendientes Registradas

Deben resolverse (vía `/speckit-clarify`) antes de implementar la feature afectada:

1. Las 12 decisiones del PRD §14 (estado cerrado y pagos pendientes, política de borrado de
   cuenta, aviso de expiración, reparto de ajustes en devoluciones, reversión de pago confirmado,
   permisos de archivo/restauración, inferencia por agregados, valores de cuotas IA, conversión
   manual, límites offline, formato de exports, monedas sin decimales).
2. **Privacidad Gemini free tier:** en el nivel gratuito Google puede usar el contenido para
   mejorar sus productos; decidir si se acepta para el MVP (con aviso al usuario) o si se exige
   un nivel de pago/otro proveedor antes de producción.
3. **Backblaze B2:** confirmar que el alta no exige tarjeta; si la exige, adoptar Supabase
   Storage (1 GB) sin cambiar contratos.
4. **Límites Spark:** validar con prototipo el costo de lecturas de balances/agregados; si se
   acerca al límite diario, introducir proyecciones agregadas.

## Governance

- Esta constitution prevalece sobre cualquier otra práctica, plantilla o preferencia puntual.
- Enmiendas: PR que modifique este archivo con justificación, Sync Impact Report actualizado y
  plan de migración para artefactos afectados.
- Versionado semántico: MAJOR = eliminación/redefinición incompatible de principios;
  MINOR = principio o sección nueva o ampliada; PATCH = aclaraciones de redacción.
- Cumplimiento: `/speckit-plan` y `/speckit-analyze` verifican cada principio; violaciones solo
  se aceptan documentadas en Complexity Tracking. La guía operativa del agente vive en
  `CLAUDE.md`.

**Version**: 1.0.1 | **Ratified**: 2026-10-13 | **Last Amended**: 2026-10-13
