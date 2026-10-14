# Implementation Plan: IA y adjuntos (Fase 4)

**Branch**: `004-receipts-ai-attachments` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-receipts-ai-attachments/spec.md`

## Summary

La Fase 4 añade comprobantes y escaneo de facturas con IA:

- **Comprobantes**: archivos privados en Backblaze B2. El navegador los sube directamente con URLs
  firmadas, y se descargan con enlaces de 15 minutos que solo emite la API tras validar permisos.
- **Escaneo de facturas**: un proveedor de IA intercambiable (Gemini con salida JSON validada)
  devuelve un borrador que se abre en el formulario de 002.
- **Cuotas atómicas**: se reservan antes de llamar al proveedor y se devuelven si el proveedor falla.
- **Consentimiento explícito** para el nivel gratuito de Gemini.
- **Retención de 6 meses** mediante un Cron Trigger idempotente.

En local y en tests no hace falta ninguna cuenta externa:
- almacenamiento local (R2 de Miniflare, solo local);
- proveedor de IA falso y determinista.

## Technical Context

**Language/Version**: TypeScript 6. `compatibility_flags: ["nodejs_compat"]` en el Worker, para
codificar base64 de forma nativa.

**Primary Dependencies**:
- Nuevas: `aws4fetch` 1.x (firma SigV4 para B2).
- Gemini REST se llama directamente con `fetch`, sin SDK.
- Sin dependencias nuevas en la web: compresión con canvas y SHA-256 con Web Crypto.

**Storage**:
- Firestore: `uploads`, `attachments` (como subcolecciones), `scans`, `aiUsage`, `users.aiConsent`.
- Archivos: B2 en producción; R2 local de Miniflare solo en desarrollo y tests.

**Testing**:
- Vitest para las funciones puras: fechas de vencimiento, normalización del borrador y avisos.
- API en workerd contra el emulador, con almacenamiento local y proveedor de IA falso.
- Adaptadores de Gemini y B2 probados con `fetch` simulado.
- Rules y Playwright (subida de fotos con `setInputFiles`).

**Target Platform**: PWA. La cámara se usa con `<input type="file" accept="image/*"
capture="environment">`, sin permisos especiales.

**Performance Goals**:
- Escaneo completo en < 15 s p95; la latencia depende del proveedor.
- CPU del Worker < 5 ms por request: la subida y la descarga no pasan por el Worker.

**Constraints**:
- Solo servicios sin tarjeta.
- Las cuotas no deben superarse ni con solicitudes concurrentes.
- Sin contenido de comprobantes en logs ni métricas.

**Scale/Scope**: unos 4 usuarios y menos de 1 GB almacenado. Se añaden:
- un flujo de escaneo y consentimiento;
- adjuntos en el formulario, el detalle y los pagos;
- avisos de vencimiento;
- un endpoint de métricas para el administrador.

## Constitution Check

| Principio | Cómo se cumple | Estado |
|---|---|---|
| I. Integridad financiera | El borrador nunca se guarda sin pasar por el formulario y el motor de 002, que exigen que cuadre. La normalización convierte los importes a enteros en unidad menor. La retención no toca datos financieros. | ✅ |
| II. Privacidad | Comprobantes privados, enlaces firmados de 15 min, permisos validados en la API (`canViewExpense`) y metadatos protegidos por Rules. Consentimiento explícito antes de enviar nada a la IA. Sin contenido en logs. | ✅ |
| III. Escrituras en servidor | Subidas, vinculación, análisis, cuotas y borrados pasan por la API o el cron. El navegador solo hace PUT a URLs firmadas que emite la API. | ✅ |
| IV. Auditable / idempotente | `Idempotency-Key` en los escaneos. Cron idempotente (borrar algo que ya no existe cuenta como éxito). Auditoría de vinculación, retirada y expiración. | ✅ |
| V. Test-first | Proveedor falso y almacenamiento local permiten pruebas de punta a punta sin red. El escenario «comprobante privado» del PRD se completa con archivos. | ✅ |
| VI. Free tier + proveedores intercambiables | Interfaces `ReceiptAIProvider` y `ReceiptStorageProvider` con adaptadores Gemini, falso, B2, local y Supabase. Cuotas atómicas. Presupuesto en research R8. | ✅ |
| VII. PWA accesible | Captura con cámara nativa; avisos y resaltados con texto (no solo color); axe en las pantallas nuevas. | ✅ |
| VIII. Simplicidad | Sin SDKs de proveedor. OpenAI solo como contrato. Notificaciones de vencimiento en la app (push en la Fase 5). | ✅ |

**Re-check post-diseño**: ✅.

## Project Structure

```text
packages/contracts/src/
├── receipts.ts      # ReceiptDraft (Zod), normalizeDraft, draftWarnings, draftToExpenseInput
├── retention.ts     # addCalendarMonths, expiresAt, isExpiringSoon
├── providers.ts     # interfaces ReceiptAIProvider, ReceiptStorageProvider
└── api/attachments.ts · api/scans.ts · api/consent.ts

apps/api/src/
├── providers/
│   ├── gemini.ts · fakeAi.ts            # ReceiptAIProvider
│   └── b2.ts · localStorage.ts · supabase.ts (stub)  # ReceiptStorageProvider
├── services/
│   ├── uploads.ts · attachments.ts · scans.ts · quotas.ts · consent.ts
│   └── retention.ts                     # cron: expired attachments + orphan uploads
├── routes/ attachments.ts · scans.ts · consent.ts · admin.ts · localBlobs.ts
└── index.ts                             # export default { fetch, scheduled }

apps/web/src/features/
├── scan/            # ScanPage (consent, capture/select, compress, sha256, progress) → NewExpensePage prefill
├── attachments/     # AttachmentPicker, AttachmentList (download, remove, expiry notice)
└── expenses/        # form shows low-confidence highlights + currency warning; detail with attachments
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Proveedor de almacenamiento local (R2 de Miniflare + endpoints firmados) | Tests E2E y de API sin cuentas externas, y desarrollo offline. | Usar B2 en los tests exigiría credenciales reales en CI. Simular solo con `fetch` no cubre el flujo del navegador. |
| Reserva y devolución de cuota | RF-51 exige no superar el límite con concurrencia y no cobrar si el proveedor falla. | Contar después de la llamada permite superar el límite con solicitudes simultáneas. |
