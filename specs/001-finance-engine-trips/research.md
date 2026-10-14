# Research: Motor financiero + identidad y viajes (Fase 0–1)

**Feature**: `001-finance-engine-trips` · **Fecha**: 2026-10-13

Cada sección resuelve una incógnita del Technical Context de `plan.md`.

## R1. Backend sin Blaze: Cloudflare Workers + límites

- **Decision**: API HTTP en Cloudflare Workers (plan Free) con Hono como router y Zod para validar.
- **Rationale**: Spark no permite Cloud Functions; Workers Free no exige tarjeta. Límites
  verificados (developers.cloudflare.com/workers/platform/limits): 100.000 req/día (reset 00:00
  UTC), **10 ms de CPU por request y por Cron Trigger**, 50 subrequests/request, 5 Cron Triggers
  por cuenta, 128 MB por isolate. El tiempo de espera de I/O (fetch a Firestore) no consume CPU.
- **Consecuencias de diseño**:
  - Verificación de tokens y firma de JWT con WebCrypto nativo (no JS puro) → <1–2 ms.
  - Access token OAuth de la service account cacheado en el scope global del isolate (~55 min).
  - Ninguna operación lee todos los gastos del viaje: los saldos se mantienen como proyección
    incremental (ver R6). Presupuesto de subrequests: ≤ 10 por operación.
- **Alternatives considered**: Vercel Functions Hobby (uso no comercial, cold starts Node);
  Supabase Edge Functions (otra plataforma de identidad); Firebase Blaze (rechazado por el
  usuario: requiere tarjeta).

## R2. Acceso a Firestore desde Workers

- **Decision**: cliente REST propio y mínimo (`apps/api/src/firestore/`) sobre
  `https://firestore.googleapis.com/v1/projects/{p}/databases/(default)/documents`, con
  `get`, `batchGet`, `runQuery`, `beginTransaction`, `commit` (writes con
  `currentDocument.exists/updateTime` como precondición) y `rollback`. Codec propio para el
  formato `Value` de Firestore (`integerValue` como string → `number` validado como entero seguro).
- **Rationale**: `firebase-admin` depende de gRPC y APIs de Node no disponibles en workerd. Las
  librerías comunitarias (p. ej. `firefighter`) no están mantenidas de forma fiable y no
  gestionan la renovación del token. El subconjunto necesario es pequeño (~300 LOC) y testeable
  contra el emulador.
- **Autenticación**: JWT RS256 firmado con la clave de la service account (secret de Workers)
  → intercambio en `https://oauth2.googleapis.com/token` (scope `datastore`). En emulador:
  `FIRESTORE_EMULATOR_HOST` + header `Authorization: Bearer owner` (omite Rules, como un admin).
- **Transacciones**: `beginTransaction` → lecturas con `transaction` → `commit`. Firestore usa
  bloqueo optimista en el servidor; si el commit falla por `ABORTED` se hace rollback y se reintenta hasta 4 veces con backoff exponencial con jitter.
- **Alternatives considered**: `firefighter` (npm); escritura desde cliente con Rules
  (rechazado por Principio III).

## R3. Verificación de Firebase ID tokens en Workers

- **Decision**: `jose` (`createRemoteJWKSet` + `jwtVerify`) con el JWKS
  `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`,
  verificando `alg=RS256`, `iss=https://securetoken.google.com/{projectId}`, `aud={projectId}`,
  `exp`, `auth_time`, `sub` no vacío y `firebase.sign_in_provider == "google.com"`.
- **Emulador**: el Auth Emulator emite tokens sin firma (`alg: none`). Solo si
  `ENVIRONMENT=emulator` el verificador acepta tokens sin firma; en cualquier otro entorno esa
  rama no existe en el build (constante en tiempo de compilación) y hay un test que lo prueba.
- **Rationale**: `jose` es compatible con workerd y usa WebCrypto; el JWKS se cachea.

## R4. Invitaciones y correo verificado

- **Decision**: correo normalizado = `trim().toLowerCase()`. Índice de invitaciones
  `invitations/{normalizedEmail}/trips/{tripId}` escrito solo por la API; la aceptación exige
  `email_verified == true` en el token y `token.email` normalizado == invitado.
- **Rationale**: el cliente solo puede leer sus invitaciones por Rules
  (`request.auth.token.email.lower() == email && request.auth.token.email_verified`), y nunca
  puede escribirlas (FR-019). No se normalizan puntos de Gmail (no es un estándar general).
- **Alternatives considered**: query de grupo sobre `members` por email (expone correos de otros
  viajes a Rules complejas); enlaces de invitación con token (no pedidos; sin email en MVP).

## R5. Lecturas del cliente vs. API

- **Decision**: el cliente usa Firestore Web SDK **solo para lecturas** de: su perfil, su índice
  `users/{uid}/trips`, el documento del viaje y sus miembros (si es miembro o invitado), y sus
  invitaciones. Los gastos (y su detalle) **no son legibles por el cliente** en esta feature; los
  saldos/deudas se obtienen vía `GET /v1/trips/{id}/balances`.
- **Rationale**: Rules deny-by-default sencillas y auditables; la privacidad de detalle (RF-38)
  se diseñará en Fase 2 sin tener que retirar permisos ya concedidos. Las lecturas en tiempo
  real del SDK reducen requests a Workers.

## R6. Saldos y deudas: proyección incremental

- **Decision**: el motor produce, por gasto, un `LedgerEffect` = { `netByMember`,
  `pairwise` (deudor→acreedor) } derivado de FR-007/FR-011. La API lo guarda en el propio gasto
  y lo suma/resta (anulación) en `trips/{tripId}/projections/ledger` **dentro de la misma
  transacción**. Pagos confirmados aportan su propio efecto (sin API en esta feature; el motor
  los soporta). La vista original = compensación por pares de `pairwise`; la simplificada se
  calcula al vuelo desde `netByMember`.
- **Rationale**: los efectos son aditivos, así que la proyección es O(1) lecturas por consulta y
  respeta el límite de 10 ms de CPU. Sigue siendo reconstruible (constitution I): función
  `rebuildLedger(expenses, payments)` del motor + test de propiedad `rebuild == incremental`.
- **Alternatives considered**: recalcular leyendo todos los gastos (N lecturas por consulta;
  insostenible con 50k lecturas/día).

## R7. Algoritmos del motor financiero

- **Reparto**: cuotas racionales con `bigint` internamente (numerador/denominador), truncado a
  unidad menor, método del mayor residuo; empates por rotación (spec FR-007):
  orden de entrada (creador, `acceptedAt`, `uid`) y offset `(seq − 1 + itemIndex) mod N`.
  Importes negativos: se reparte el valor absoluto y se aplica el signo (simetría garantizada).
- **Porcentajes**: enteros en puntos básicos (100,00 % = 10000).
- **Ajustes**: orden de aplicación por ítem: bruto → descuento del ítem → (neto de ítem). Ajustes
  generales (descuento general, impuesto, propina) se reparten sobre beneficiarios según modo:
  proporcional al consumo pre-ajuste, equitativo (partes iguales entre beneficiarios del gasto),
  manual (importes explícitos que suman el ajuste).
- **Pagadores**: cargo de cada beneficiario repartido entre pagadores proporcionalmente a su
  aporte con el mismo algoritmo (desempate por la misma rotación sobre pagadores).
- **Simplificación**: voraz determinista — repetir: mayor deudor paga al mayor acreedor
  `min(|d|, c)`; empates por orden de entrada. Garantiza ≤ N−1 transferencias y conserva netos.
- **Testing**: fast-check con generadores de viajes (≤ 50 miembros, ≤ 100 ítems, monedas con
  0/2/3 decimales); propiedades: conciliación, suma cero, invariancia ante permutación de la
  entrada, simplificada conserva netos y no supera a la original, `rebuild == incremental`.

## R8. Catálogo ISO 4217

- **Decision**: tabla estática versionada en `packages/finance-engine/src/currencies.ts` (el motor
  no tiene dependencias; `packages/contracts` la reexporta)
  (código → decimales), generada desde la lista oficial SIX ISO 4217 (List One) y revisada a mano.
- **Rationale**: `Intl.NumberFormat` difiere de ISO en algunas monedas (p. ej. ISK, HUF según
  motor JS); la contabilidad necesita la fuente oficial. Presentación sí usa `Intl`.

## R9. Concurrencia, idempotencia y secuencia de gastos

- **Decision**: cada mutación lee y escribe dentro de una transacción Firestore. `trip.version`
  y `trip.expenseSeq` se incrementan en el commit; `expectedVersion` desactualizado → `CONFLICT`.
  `idempotencyKeys/{tripId}_{uid}_{key}` se crea con precondición `exists=false` en la misma
  transacción; un reintento devuelve el resultado guardado.
- **Aceptación vs. primer gasto**: ambas operaciones leen `trip` y `members` en transacción; el
  commit de una invalida a la otra (ABORTED → reintento con datos frescos), por lo que nunca se
  registra un gasto con invitados pendientes.

## R10. Frontend

- **Decision**: React 19 + TypeScript strict + Vite 8, React Router 7, TanStack Query 5 (llamadas
  a la API) + listeners del SDK de Firestore para lecturas en vivo, React Hook Form + Zod
  (esquemas de `packages/contracts`), Tailwind CSS 4, `vite-plugin-pwa` (manifest e
  instalabilidad; offline fuera de alcance), Firebase JS SDK 12 (Auth + Firestore lite).
- **Login**: `signInWithPopup` en escritorio y `signInWithRedirect` en iOS Safari standalone
  (los popups fallan en PWAs instaladas).

## R11. Tooling y entorno local

- pnpm 10 workspaces, Node 24 (instalado), TypeScript 6, Vitest 4, fast-check 4,
  `@cloudflare/vitest-pool-workers` (tests de la API dentro de workerd), Wrangler 4,
  `@firebase/rules-unit-testing` 5 (Rules), Playwright 1.6x (E2E contra emuladores).
- **Firebase Emulator Suite requiere Java 21+** (firebase-tools v15 dejó de soportar < 21). El
  equipo tiene OpenJDK 17 → instalar `openjdk@21` (ver quickstart).
- CI: GitHub Actions gratuito (lint, typecheck, tests con emuladores).

## R12. Presupuesto free tier (estimación por operación)

| Operación | Lecturas Firestore | Escrituras | Requests Workers |
|---|---|---|---|
| Crear viaje | 1 | 3 (viaje, miembro creador, índice usuario) + auditoría 1 | 1 |
| Invitar | 2 + miembros (≤50) | 3 | 1 |
| Aceptar invitación | 2 + miembros | 3–4 | 1 |
| Registrar gasto | 3 + miembros | 4 (gasto, proyección, viaje, idempotencia) + auditoría 1 | 1 |
| Ver saldos | 2 + miembros (proyección, viaje, query de miembros) | 0 | 1 |

Con 10 viajes activos × 30 gastos/día y 100 consultas de saldos/día el uso estimado queda
< 5 % de 50k lecturas y < 3 % de 20k escrituras diarias.
