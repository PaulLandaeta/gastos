# Contrato de la interfaz offline y PWA (cliente)

## Estado de conexión

- `useOnline()`: `navigator.onLine` + eventos `online`/`offline`; un fallo `NETWORK` del `apiClient` también marca
  «sin conexión» hasta la siguiente petición correcta.
- **Barra de estado** (siempre visible en el layout): «Sin conexión · datos del {fecha}» y, si hay, «{n} pendientes» y
  «{m} requieren atención» (enlace a `/pending`). Texto + icono, no solo color; `role="status"`.

## Acciones según conexión

| Acción | Sin conexión |
|---|---|
| Ver viajes, gastos visibles, saldos, pagos (abiertos ≤ 30 días) | ✅ desde caché, con «datos guardados» |
| Crear gasto manual (total o ítems) | ✅ → pendiente |
| Editar / descartar un pendiente propio | ✅ (bloqueado solo mientras `sending`) |
| Escanear, adjuntar, pagar, confirmar, editar o anular gastos reales, devoluciones, gestión del viaje, exportar, marcar notificaciones | ❌ botón deshabilitado con «Necesita conexión»; un formulario abierto conserva lo escrito |

## Pendientes

- En la lista de gastos del viaje aparecen arriba con la etiqueta «Pendiente», «Enviando» o «Requiere atención».
  No cuentan en los saldos hasta sincronizarse (se indica en la propia etiqueta).
- `/pending`: lista de todos los pendientes de la cuenta con «Reintentar ahora», «Editar», «Descartar» (confirmación)
  y, para `POSSIBLE_DUPLICATE`, «Enviar igualmente».
- Cerrar sesión con pendientes: diálogo «Tienes {n} gastos sin enviar. Si cierras sesión se borrarán de este
  dispositivo.» → «Cancelar» / «Borrar y cerrar sesión».

## PWA

- Aviso de actualización: «Hay una versión nueva» → «Actualizar» (no se recarga sola).
- «Instalar app» en el menú cuando hay `beforeinstallprompt`; en iOS Safari, guía de «Añadir a pantalla de inicio».
- Sin conexión, cualquier ruta abre el shell (`navigateFallback`) en lugar de la página de error del navegador.

## Notificaciones

- Campana en la cabecera con contador de no leídas (`aria-label="{n} notificaciones sin leer"`, «99+»).
- `/notifications`: lista (más recientes primero), «Marcar todas como leídas», menú por elemento leído/no leído.
  Tocar un elemento lo marca como leído y navega a `link`.

## Exportación

- En el viaje: «Exportar» → «Excel detallado» / «PDF resumen». Progreso «Preparando…» sin bloquear la interfaz.
  Nombre de archivo: `gastos-{viaje}-{AAAA-MM-DD}.xlsx|pdf`. Si es un participante, el archivo indica «Incluye solo los
  gastos que puedes ver».
