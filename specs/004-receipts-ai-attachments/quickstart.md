# Quickstart: 004-receipts-ai-attachments

## Local (sin cuentas externas)

Igual que 001 (`pnpm emulators`, web :5180). La API corre con el entorno de emulador, que usa el
almacenamiento local (R2 de Miniflare, solo local) y el proveedor de IA falso determinista:

```bash
pnpm --filter api dev            # wrangler dev --env emulator  (AI_PROVIDER=fake, STORAGE=local)
pnpm test && pnpm test:rules && pnpm --filter web test:e2e
```

## Producción (cuando se despliegue)

1. **Backblaze B2** (10 GB gratis): crear cuenta, confirmar que no pide tarjeta, crear un bucket
   **privado** y una application key limitada a ese bucket. CORS del bucket: origen = dominio de
   Hosting, métodos `PUT, GET`, cabeceras `content-type`.
   `wrangler secret put B2_KEY_ID`, `B2_APPLICATION_KEY`; vars `B2_BUCKET`, `B2_ENDPOINT`, `B2_REGION`.
   Si B2 exigiera tarjeta: usar el adaptador de Supabase Storage (misma interfaz).
2. **Gemini**: clave en Google AI Studio (sin tarjeta). `wrangler secret put GEMINI_API_KEY`;
   var `GEMINI_MODEL` con un modelo Flash disponible en el nivel gratuito (ver consola de AI Studio).
3. Cuotas: vars `AI_QUOTA_TRIP_DAY=20`, `AI_QUOTA_GLOBAL_DAY=100`, `AI_QUOTA_GLOBAL_MONTH=1500`;
   `ADMIN_UIDS` para la consulta de métricas.
4. Cron Trigger horario ya declarado en `wrangler.jsonc` (retención y limpieza).

## Recorrido de aceptación

1. Ana pulsa «Escanear factura» → aviso de privacidad → «Acepto» → toma/sube la foto de un ticket.
2. El formulario se abre con comercio, fecha, ítems y total; campos dudosos resaltados; si la moneda
   detectada no es la del viaje, aparece la advertencia.
3. Ana asigna beneficiarios, el total cuadra, guarda → el gasto muestra «Escaneado» y el comprobante.
4. Juan (no involucrado) no ve el gasto ni puede abrir el comprobante con el enlace copiado; el
   enlace deja de funcionar a los 15 minutos.
5. Ana adjunta un PDF a otro gasto; volver a subir el mismo archivo avisa «ya adjunto».
6. Con la cuota del viaje agotada, «Escanear factura» informa y ofrece el registro manual.
7. Un comprobante con `expiresAt` en 10 días muestra el aviso; tras forzar el cron con fecha futura,
   el archivo se borra y el gasto indica «comprobante eliminado por política de retención».
