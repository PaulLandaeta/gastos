# Security Review: 004-receipts-ai-attachments

**Fecha**: 2026-10-14 · **Alcance**: subidas, comprobantes, escaneo con IA, consentimiento, cuotas y retención.
**Resultado**: sin hallazgos abiertos de severidad alta.

## Verificado

- [x] **Enlaces con caducidad**: descargas con URL firmada de 900 s (`DOWNLOAD_URL_TTL_SECONDS`), emitida solo tras
      `canViewExpense` (gasto) o emisor/receptor/gestor (pago); enlace caducado → 403 (test). Subidas con PUT firmado
      de 900 s ligado al `content-type` declarado. La B2 firma además `response-cache-control: private, no-store`.
- [x] **Privacidad (RF-38)**: lista, URL y aviso de vencimiento devuelven 404 a quien no ve el gasto; Rules espejo
      (adjuntos heredan del padre, `uploads`/`scans` solo su dueño, `aiUsage` nadie). Test E2E «comprobante privado».
- [x] **Validación antes de almacenar**: tipo (lista cerrada), tamaño (10 MB), páginas (PDF ≤ 10) → `ATTACHMENT_INVALID`
      sin crear nada; al vincular, `head()` debe coincidir en bytes y tipo, si no se borra el objeto.
- [x] **Rutas de almacenamiento**: claves `trips/{t}/uploads/{id}/{nombre-saneado}`; el nombre del usuario nunca forma
      segmentos de ruta. IDs de ruta con `assertSafeId`.
- [x] **Consentimiento IA**: obligatorio y versionado (`AI_CONSENT_REQUIRED` antes de leer subidas o reservar cuota);
      revocable; fechado en `users/{uid}.aiConsent`.
- [x] **Sin contenido en logs ni métricas**: `scan_failed` registra solo ids, proveedor y código; métricas solo contadores
      (test). El cuerpo de Gemini no se registra.
- [x] **Cuotas**: reserva atómica en transacción (test de concurrencia: solo una pasa), devolución en fallo, reintentos
      por archivo limitados, idempotencia por `Idempotency-Key` sin doble consumo.
- [x] **Endpoints locales**: `/local-blobs/*` y `/local-admin/run-retention` responden 404 fuera del emulador (test);
      `FakeReceiptProvider` y `LocalStorageProvider` lanzan error si se configuran fuera del emulador (test).
- [x] **Secretos**: `GEMINI_API_KEY`, `B2_KEY_ID`, `B2_APPLICATION_KEY` solo como `wrangler secret`; la clave B2 debe
      limitarse al bucket (README). La API key de Gemini va en cabecera `x-goog-api-key`, no en la URL.
- [x] **Retención**: el cron solo cambia estado de adjuntos/subidas y `attachmentCount`; no toca importes, saldos ni
      auditoría (test). Idempotente y con reintentos (`deleteAttempts`).

## Riesgos aceptados

- Nivel gratuito de Gemini: el proveedor puede usar las imágenes para mejorar sus productos. Mitigado con aviso y
  consentimiento explícito (FR-015); el registro manual no envía nada a la IA.
- Las URL firmadas son portadoras durante 15 minutos: quien reciba un enlace copiado puede abrirlo en ese intervalo.
- El hash SHA-256 lo calcula el navegador: un cliente malicioso podría evitar la detección de duplicados (solo afecta a
  su propio almacenamiento, sin impacto en terceros).
