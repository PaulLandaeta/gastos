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
  - `005-pwa-offline-collaboration`: PWA instalable, registro sin conexión con cola local, notificaciones internas y
    exportación Excel/PDF sujeta a privacidad.
  - `006-hardening-pilot`: baja y anonimización de cuenta (RF-56), despliegue reproducible con smoke test, backups
    cifrados con restauración probada, monitoreo, CSP, rate limiting y lista de lanzamiento del piloto.

## Stack (sin tarjeta de crédito)

| Capa | Tecnología |
|---|---|
| Web | React 19 + Vite PWA (`apps/web`) |
| API | Cloudflare Workers Free + Hono (`apps/api`) |
| Datos / Auth | Firebase Spark: Firestore + Google Auth + Hosting |
| Comprobantes | Backblaze B2 (URLs firmadas), R2 de Miniflare en local |
| IA | OpenAI (crédito prepagado) tras `ReceiptAIProvider`, Gemini gratuito como alternativa; proveedor falso en local |
| Motor financiero | TypeScript puro, enteros en unidad menor (`packages/finance-engine`) |
| Operación | `apps/ops` (Node): preflight, smoke, backup/restore; GitHub Actions (CI, Lighthouse, backup, uptime) |

## Desarrollo

Requisitos: Node 24, pnpm 10, Java 21 (emuladores), firebase-tools 15.

```bash
pnpm install
pnpm emulators            # Auth + Firestore locales
pnpm test && pnpm test:rules      # incluye los tests de apps/ops (simulacro de backup/restore)
pnpm --filter api perf            # presupuesto de CPU del Worker
pnpm --filter web test:e2e
```

Guía completa: [`specs/001-finance-engine-trips/quickstart.md`](specs/001-finance-engine-trips/quickstart.md).

## Producción y operación

- Despliegue y vuelta atrás: [`docs/deploy.md`](docs/deploy.md) (`pnpm deploy:prod`).
- Monitoreo, backups, restauración, costos y límites: [`docs/operations.md`](docs/operations.md).
- Revisión de seguridad: [`docs/security-review.md`](docs/security-review.md).
- Piloto: [`docs/launch-checklist.md`](docs/launch-checklist.md) y [`docs/pilot-guide.md`](docs/pilot-guide.md).
