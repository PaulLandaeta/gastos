# Implementation Plan: Motor financiero + identidad y viajes (Fase 0–1)

**Branch**: `001-finance-engine-trips` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-finance-engine-trips/spec.md`

## Summary

Construir los cimientos del producto:
1. Un **motor financiero puro** en TypeScript que reparte gastos (total o por ítem; igual, fijo
   o porcentaje; ajustes proporcionales, equitativos o manuales; mixtos personal/compartido;
   varios pagadores). Usa enteros en unidad menor y redondeo de mayor residuo con desempate
   rotativo por número de secuencia del gasto. Produce saldos de suma cero y dos vistas de
   deudas (original compensada por pares y simplificada voraz).
2. **Identidad y viajes**: login Google (Firebase Auth), viajes con moneda única, invitaciones
   por correo verificado, roles, máquina de estados y bloqueos tras el primer gasto.

Toda escritura pasa por una API en **Cloudflare Workers** (Firebase Spark no permite Cloud
Functions). La API accede a Firestore por REST con transacciones y mantiene una **proyección
incremental** de saldos para cumplir 10 ms de CPU por request. El cliente React solo lee por
SDK lo que permiten las Rules (deny-by-default). El registro y la anulación de gastos existen
solo a nivel de servicio (FR-028).

## Technical Context

**Language/Version**: TypeScript 6 (strict) sobre Node 24 (tooling) y workerd (API)

**Primary Dependencies**:
- Web: React 19, Vite 8, React Router 7, TanStack Query 5, React Hook Form 7, Zod 4,
  Tailwind CSS 4, vite-plugin-pwa 1, Firebase JS SDK 12.
- API: Hono 4, jose 6, Zod 4.
- Motor: sin dependencias de runtime.

**Storage**: Cloud Firestore (Firebase Spark). Sin almacenamiento de archivos en esta feature.

**Testing**: Vitest 4, fast-check 4, `@cloudflare/vitest-pool-workers`,
`@firebase/rules-unit-testing` 5, Playwright, Firebase Emulator Suite (Auth + Firestore; Java 21).

**Target Platform**:
- PWA para Chrome Android y Safari iOS recientes (y escritorio).
- API en Cloudflare Workers Free.
- Hosting en Firebase Hosting.

**Project Type**: aplicación web (monorepo: PWA + API edge + librerías compartidas)

**Performance Goals**:
- Operaciones de API < 2 s p95 en red móvil razonable (PRD §11).
- CPU < 10 ms por request (límite del plan Free).
- Motor: un gasto de 100 ítems × 50 miembros en < 2 ms.

**Constraints**:
- Solo servicios sin tarjeta.
- 100k req/día (Workers); 50k lecturas y 20k escrituras/día (Firestore).
- ≤ 50 subrequests por request.
- Sin `float` en contabilidad.

**Scale/Scope**: piloto. ≤ 50 miembros por viaje, ≤ 200 ítems por gasto, decenas de viajes
activos. ~8 pantallas: login, mis viajes, crear viaje, detalle/estado del viaje, miembros y
roles, invitaciones, saldos (lectura) y ajustes de cuenta mínimos.

Sin NEEDS CLARIFICATION pendientes: todas las incógnitas están resueltas en [research.md](./research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | Enteros en unidad menor, `bigint` en cuotas racionales, mayor residuo con desempate rotativo documentado (v1.0.1), invariantes de suma cero y conciliación con tests de propiedades, proyección reconstruible (`rebuildLedger == incremental`). | ✅ |
| II. Privacidad deny-by-default | Rules deny-all con lecturas mínimas ([access-rules](./contracts/access-rules.md)). Gastos y proyección no legibles por el cliente. Logs con correlation ID y sin PII. Viajes ajenos → 404. | ✅ |
| III. Escrituras solo en servidor | Toda mutación vía Worker. ID token verificado con JWKS. Membresía, rol y estado re-validados en la misma transacción. | ✅ |
| IV. Auditable, versionado, idempotente | `expectedVersion` → `CONFLICT`, `Idempotency-Key` obligatoria en gastos, anulación lógica, `auditEvents` en cada mutación. | ✅ |
| V. Test-first | Orden TDD en tasks. Escenarios críticos del enunciado como tests. Tests negativos por cada Rule. Cobertura ≥ 95 % en el motor. | ✅ |
| VI. Free-tier first | Workers Free + Firebase Spark. Presupuesto por operación en research R12. Proveedores IA y storage no se usan aún. | ✅ |
| VII. PWA mobile-first, accesible | Manifest + instalabilidad, diseño mobile-first, WCAG AA en formularios. Offline fuera de alcance. | ✅ |
| VIII. Simplicidad | Sin UI de gastos, sin liquidaciones, sin storage. Cliente REST propio mínimo en lugar de SDK pesado (justificado en Complexity Tracking). | ✅ |

**Re-check post-diseño (Phase 1)**: ✅ sin violaciones nuevas. El diseño de Rules se simplificó
(los invitados leen solo su índice `invitations`). La proyección incremental mantiene la regla
"snapshots no son fuente de verdad" porque hay reconstrucción verificada por test.

## Project Structure

### Documentation (this feature)

```text
specs/001-finance-engine-trips/
├── plan.md              # este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── http-api.md      # API v1 del Worker
│   └── access-rules.md  # matriz de Security Rules
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · firebase.json

packages/
├── finance-engine/
│   ├── src/
│   │   ├── currencies.ts      # ISO 4217 → decimales (sin dependencias)
│   │   ├── money.ts           # minorUnits, safe-int guards
│   │   ├── allocate.ts        # largest remainder + rotation
│   │   ├── expense.ts         # computeExpense (items, ajustes, pagadores)
│   │   ├── ledger.ts          # LedgerEffect, combine/negate, rebuildLedger, paymentEffect
│   │   ├── debts.ts           # originalDebts, simplifiedDebts
│   │   └── index.ts
│   └── tests/
│       ├── unit/              # catálogo de casos (PRD + spec)
│       └── property/          # fast-check
└── contracts/
    └── src/
        ├── currencies.ts      # reexporta la tabla del motor
        ├── errors.ts          # ErrorCode
        ├── domain.ts          # Trip, Member, enums de estado/rol
        └── api/               # esquemas Zod request/response por endpoint

apps/
├── api/                       # Cloudflare Worker
│   ├── wrangler.jsonc
│   ├── src/
│   │   ├── index.ts           # Hono app, middlewares (auth, correlation, errores)
│   │   ├── auth/verifyIdToken.ts
│   │   ├── firestore/         # client REST, codec Value, transacciones, service-account token
│   │   ├── services/          # trips, invitations, roles, status, expenses, balances, audit
│   │   └── routes/
│   └── tests/                 # vitest-pool-workers contra emulador
└── web/                       # React PWA
    ├── src/
    │   ├── app/               # router, providers (Query, Auth)
    │   ├── features/auth/     # login, logout, sync
    │   ├── features/trips/    # lista, crear, detalle, estado
    │   ├── features/members/  # invitaciones, aceptación, roles
    │   ├── features/balances/ # vista original/simplificada (lectura)
    │   └── lib/               # firebase, apiClient, formato moneda/fechas
    └── tests/e2e/             # Playwright

firebase/
├── firestore.rules
├── firestore.indexes.json
└── tests/rules.test.ts
```

**Structure Decision**: monorepo pnpm con dos apps (`web`, `api`) y dos paquetes (`finance-engine`,
`contracts`), tal como fija la constitution. El motor no tiene dependencias para poder
reutilizarlo en el cliente (vista previa en Fase 2) y en la API.

## Trazabilidad de escenarios Gherkin del PRD (§6.1)

La constitution (Principio V) exige los 6 escenarios críticos como tests en CI. Estado en esta
feature:

| Escenario PRD | Cubierto en | Test |
|---|---|---|
| Todos deben aceptar antes del primer gasto (`TRIP_NOT_READY`) | 001 | T065, T068 |
| Factura compartida con redondeo exacto (10.00 / 3) | 001 | T027, T028, T067 |
| Pago pendiente no afecta balances | 001 (motor) | T029; API de pagos en feature de Fase 3 |
| Moneda congelada tras primer gasto anulado | 001 | T066 |
| Conflicto de edición concurrente de un gasto (versión 4 → 5 / `CONFLICT`) | **Diferido** a Fase 3 (edición de gastos) | En 001 se cubre el mecanismo con viajes: T046, T048 |
| Usuario sin acceso al comprobante privado | **Diferido** a Fase 2 (privacidad RF-38) y Fase 4 (adjuntos) | En 001: gastos ilegibles por cliente, T049 |

Cada feature posterior MUST actualizar esta tabla hasta cubrir los 6.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Cliente REST propio de Firestore (~300 LOC) | `firebase-admin` no funciona en workerd y las alternativas comunitarias no renuevan tokens. | Escribir desde el cliente con Rules viola el Principio III. Una dependencia sin mantenimiento es un riesgo mayor. |
| Proyección incremental de saldos | 10 ms de CPU y 50k lecturas/día impiden recalcular leyendo todos los gastos. | Recalcular al vuelo: N lecturas por consulta, agota la cuota con pocos viajes activos. |
