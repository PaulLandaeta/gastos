# Research: PWA y colaboración (Fase 5)

## R1. Caché de lectura offline

- **Decision**: dos capas, ambas por cuenta:
  1. **Firestore**: `initializeFirestore` con `persistentLocalCache({ tabManager: persistentMultipleTabManager(),
     cacheSizeBytes: 40 MB })`. Los `onSnapshot` actuales (`useDoc`/`useCollection`) sirven desde caché sin red y
     marcan `metadata.fromCache`. Las Rules siguen aplicando: el SDK solo guarda lo que el usuario pudo leer.
  2. **Respuestas de la API** (saldos, estadísticas, listados filtrados): `persistQueryClient` de TanStack Query con
     un persister asíncrono sobre IndexedDB (`idb-keyval`), `maxAge` 30 días, ~10 MB, clave `rq-cache:<uid>`.
     Solo se persisten consultas marcadas `meta.persist = true`.
- **Límite de 30 días**: un índice local `tripAccess` (`tripId → lastOpenedAt`) en IndexedDB. Al arrancar se purgan
  de la caché de consultas los viajes con `lastOpenedAt` > 30 días y la vista offline solo lista viajes abiertos en
  los últimos 30 días. El GC LRU del SDK de Firestore elimina los documentos sin listener cuando se supera el tamaño.
- **Separación por cuenta**: se guarda `cacheOwnerUid` en `localStorage`. Si al iniciar sesión el uid difiere (o al
  cerrar sesión): `terminate(db)` + `clearIndexedDbPersistence(db)`, borrado de `rq-cache:*` y recarga. Los pendientes
  viven en una base IndexedDB por uid (`gastos-outbox-<uid>`), así otra cuenta nunca los ve.
- **Rationale**: reutiliza el mecanismo existente de lectura en vivo sin duplicar datos; cero dependencias pesadas.
- **Alternatives**: copia propia de todos los datos en IndexedDB (duplicaría el modelo y la lógica de privacidad);
  cachear respuestas de la API en el service worker (no distingue cuentas ni caduca por viaje).

## R2. Cola de gastos pendientes (outbox)

- **Decision**: base IndexedDB `gastos-outbox-<uid>` con el store `pendingExpenses` (librería `idb`, ~1 KB). Cada
  registro guarda el `CreateExpenseInput` validado con el mismo Zod de `contracts`, `idempotencyKey` (UUID v4 fijada al
  crear y conservada al editar), estado y motivo. El motor `syncOutbox()`:
  - se dispara con el evento `online`, al iniciar la app con sesión, al volver a primer plano (`visibilitychange`) y
    con el botón «Reintentar»;
  - envía en orden de `createdAt`, uno a uno, con `POST /trips/{t}/expenses` + `Idempotency-Key`;
  - usa un lock (`navigator.locks.request('outbox-<uid>')`) para que dos pestañas no envíen a la vez;
  - clasifica la respuesta: 2xx → `synced` (se borra del store y se invalida la caché); `NETWORK`/5xx/429 → sigue
    `pending` con backoff (2 s, 4 s… máx. 5 min); 4xx de negocio → `needs_attention` con `code` y mensaje.
- **Idempotencia**: el servidor guarda la clave 7 días (`idempotency.ts`). Un pendiente nunca enviado no tiene clave
  registrada, así que no caduca. Si un envío llegó pero se perdió la respuesta, el reintento devuelve el mismo gasto
  (mientras no pasen 7 días; más allá, el detector de duplicados RF-22 lo frena con `POSSIBLE_DUPLICATE`).
- **Duplicado posible** (`POSSIBLE_DUPLICATE`): pasa a `needs_attention`; «Enviar igualmente» reenvía con
  `confirmDuplicate: true` y la misma clave.
- **Background Sync API**: no se usa (no existe en Safari iOS); la sincronización ocurre con la app abierta.
- **Alternatives**: Workbox Background Sync (repetiría peticiones sin poder mostrar «requiere atención» ni editar);
  escribir en Firestore offline con el SDK (viola el Principio III).

## R3. Validación offline del formulario

- **Decision**: el formulario de 002 ya valida con Zod y `finance-engine` en el cliente (cuadre, ítems, reparto). Sin
  conexión usa los datos en caché (miembros, categorías, moneda, estado del viaje). Si el viaje está cerrado o
  archivado en caché, no permite crear. El servidor revalida todo al sincronizar.
- **Rationale**: misma validación en ambos modos; el servidor sigue siendo la autoridad (Principio III).

## R4. Instalación y actualización de la PWA

- **Decision**: `vite-plugin-pwa` con `registerType: 'prompt'` (en lugar de `autoUpdate`) y `useRegisterSW`:
  aviso «Nueva versión disponible → Actualizar». Precarga del shell y `navigateFallback: '/index.html'` (rutas SPA
  offline). Sin caché en el SW para la API, Firestore ni B2 (R1 se ocupa de los datos). Botón «Instalar» con
  `beforeinstallprompt` en Android/escritorio; en iOS, una guía «Compartir → Añadir a pantalla de inicio». Iconos
  existentes + `apple-touch-icon` y `theme-color`.
- **Rationale**: la actualización no borra IndexedDB, así que los pendientes sobreviven (US2-2); `prompt` evita
  recargar con un formulario a medias.
- **Verificación**: Playwright comprueba manifest, SW activo y apertura offline (`context.setOffline(true)`) sobre el
  build de `vite preview`; Lighthouse (instalabilidad) como verificación manual documentada.

## R5. Notificaciones internas

- **Decision**: documentos `users/{uid}/notifications/{id}` escritos por la API **en la misma transacción** que la
  acción que los origina (gasto, pago, devolución, estado del viaje, invitación). Un módulo puro
  `notificationsFor(event)` en `apps/api/src/services/notifications.ts` decide destinatarios y texto con
  `canViewExpense` y la regla de la clarificación 3 (solo cambia la parte del usuario). El autor se excluye.
  - Comprobante por vencer: lo genera el cron horario existente cuando un adjunto entra en la ventana de 14 días,
    una sola vez (`expiringNotifiedAt` en el adjunto).
  - Lectura en vivo: `onSnapshot` sobre `users/{uid}/notifications` ordenado por `createdAt desc` con `limit(50)`, y
    otra consulta `where('readAt','==',null)` con `limit(100)` para el contador ("99+").
  - Marcar leído o no leído: `POST /me/notifications/read` y `/unread` por la API (cliente sin escrituras).
  - Retención 90 días: campo `expiresAt`; el cron borra en lotes de 200 con una consulta collection group
    `notifications where expiresAt < now`.
  - Navegación: `link` es una ruta de la app; al abrir, la pantalla destino ya aplica la visibilidad (si no puede ver
    el gasto, muestra «ya no disponible»).
- **Privacidad**: el texto solo incluye descripción e importe cuando el destinatario puede ver el gasto en ese momento.
  A quien se quita de un gasto se le notifica «Ya no participas en un gasto del viaje X», sin detalle.
- **Coste**: ~4 participantes × pocas decenas de eventos/día → < 500 escrituras/día; muy por debajo de 20k.
- **Alternatives**: generar notificaciones con triggers (requiere Cloud Functions/Blaze); calcularlas al leer desde
  la auditoría (complejo y costoso en lecturas).

## R6. Exportación Excel/PDF

- **Decision**: el servidor arma los **datos** y el navegador genera el **archivo**:
  - `GET /trips/{t}/export?format=xlsx|pdf&cursor=` → páginas JSON de ≤ 100 gastos ya filtrados con `canViewExpense`.
    La primera página trae el `header` (saldos y deudas original/simplificada desde las proyecciones y el
    `finance-engine`, pagos, devoluciones, totales) y registra la auditoría `trip.exported`. Paginar mantiene cada
    petición bajo los 10 ms de CPU: parsear la respuesta REST de ~1.000 gastos con ítems en una sola petición no cabe.
  - El cliente genera el archivo con importaciones dinámicas: **Excel** con `write-excel-file` (MIT, sin
    dependencias nativas, hojas múltiples); **PDF** con `jspdf` + `jspdf-autotable` (MIT). Se descarga con un
    `Blob` + `URL.createObjectURL` que se revoca al terminar. Nada se almacena en el servidor ni en B2.
  - Formato monetario: celdas numéricas en unidades mayores (`minor / 10^decimals`) con formato de número de la moneda
    del viaje (respeta monedas sin decimales); totales calculados en enteros antes de convertir, así cuadran al centavo.
- **Rationale**: un Worker Free tiene ~10 ms de CPU por petición; generar un XLSX/PDF de 1.000 gastos allí no cabe.
  Armar el JSON es el trabajo que ya hacen los listados. El archivo efímero en memoria cumple «nunca público ni
  permanente» por construcción. La privacidad se decide en el servidor (Principio II).
- **Alternatives**: SheetJS (la versión de npm está desactualizada y la actual se distribuye fuera del registro);
  `exceljs` (~1 MB, más pesado); generar en el Worker y subir a B2 con URL firmada (CPU y almacenamiento innecesarios).

## R7. Presupuesto free tier (delta de la Fase 5)

| Recurso | Uso estimado (4 usuarios, viaje activo) | Límite |
|---|---|---|
| Firestore lecturas | caché local reduce relecturas; notificaciones ~50 listener reads/usuario/día | 50k/día |
| Firestore escrituras | notificaciones < 500/día; marcados de leído < 100/día | 20k/día |
| Workers requests | sync de pendientes y exportaciones: < 200/día | 100k/día |
| Workers CPU | exportación: cada página de 100 gastos y la primera página con saldos < 10 ms medido en `perf` | 10 ms |
| Almacenamiento local | ≤ 50 MB por cuenta en el dispositivo | — |
