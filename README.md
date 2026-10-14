# gastos

Gastos de viaje colaborativos: registro, reparto exacto al centavo y liquidación de gastos entre participantes de un viaje.

- **PRD**: [`PRD_Gastos_de_Viaje_React_Firebase.md`](PRD_Gastos_de_Viaje_React_Firebase.md)
- **Constitution (SDD con Spec Kit)**: [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- **Features**: [`specs/`](specs/) — cada una con spec, plan, contratos y tareas.
  - `001-finance-engine-trips`: motor financiero, login Google, viajes, invitaciones, roles, estados y saldos.
  - `002-manual-expenses-privacy`: registro manual (total o por ítems), categorías, privacidad del detalle (RF-38),
    gastos personales, dashboard con filtros, anulación con historial y aviso de duplicados.
  - `003-settlements-edits-refunds`: pagos con confirmación del receptor, edición con control de conflictos,
    previsualización de impacto en saldos, restauración de gastos y devoluciones por ítem.
  - `004-receipts-ai-attachments`: comprobantes privados (fotos y PDF) en gastos y pagos, escaneo de facturas con IA
    (consentimiento, borrador revisable), cuotas atómicas de IA y retención de 6 meses.

## Stack (sin tarjeta de crédito)

| Capa | Tecnología |
|---|---|
| Web | React 19 + Vite PWA (`apps/web`) |
| API | Cloudflare Workers Free + Hono (`apps/api`) |
| Datos / Auth | Firebase Spark: Firestore + Google Auth + Hosting |
| Comprobantes | Backblaze B2 (URLs firmadas), R2 de Miniflare en local |
| IA | Gemini (nivel gratuito) tras `ReceiptAIProvider`; proveedor falso en local |
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
