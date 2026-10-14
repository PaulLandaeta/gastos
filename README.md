# gastos

Gastos de viaje colaborativos: registro, reparto exacto al centavo y liquidación de gastos entre participantes de un viaje.

- **PRD**: [`PRD_Gastos_de_Viaje_React_Firebase.md`](PRD_Gastos_de_Viaje_React_Firebase.md)
- **Constitution (SDD con Spec Kit)**: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- **Features**: [`specs/`](specs/) — cada una con spec, plan, contratos y tareas.

## Stack (sin tarjeta de crédito)

| Capa | Tecnología |
|---|---|
| Web | React 19 + Vite PWA (`apps/web`) |
| API | Cloudflare Workers Free + Hono (`apps/api`) |
| Datos / Auth | Firebase Spark: Firestore + Google Auth + Hosting |
| Motor financiero | TypeScript puro, enteros en unidad menor (`packages/finance-engine`) |

## Desarrollo

Requisitos: Node 24, pnpm 10, Java 21 (emuladores), firebase-tools 15.

```bash
pnpm install
pnpm emulators            # Auth + Firestore locales
pnpm test && pnpm test:rules
pnpm --filter web test:e2e
```

Guía completa: [`specs/001-finance-engine-trips/quickstart.md`](specs/001-finance-engine-trips/quickstart.md).
Despliegue: [`apps/api/README.md`](apps/api/README.md).
