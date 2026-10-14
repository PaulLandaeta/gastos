# Quickstart: 005-pwa-offline-collaboration

## Local

Igual que 004 (`pnpm emulators`, API :8787 con `--env emulator`, web :5180). Sin cuentas externas nuevas.

```bash
pnpm test && pnpm test:rules && pnpm --filter api perf
pnpm --filter web test:e2e          # incluye los escenarios offline (context.setOffline) sobre vite preview
```

El service worker solo se registra en el build. El proyecto Playwright `pwa` construye en `dist-e2e/` y lo sirve
con `vite preview` en el **5181** (origen ya permitido en CORS del entorno emulador; si la API ya estaba corriendo,
reiníciala para que lea el nuevo `ALLOWED_ORIGINS`). A mano:
`pnpm --filter web exec vite build --outDir dist-e2e && pnpm --filter web exec vite preview --outDir dist-e2e --port 5181`
y Chrome DevTools → Application.

## Recorrido de aceptación

1. Ana abre el viaje con conexión → DevTools «Offline» → recarga: ve el viaje, gastos, saldos y la barra
   «Sin conexión · datos del …».
2. Sin conexión registra dos gastos → aparecen como «Pendiente» y la barra dice «2 pendientes»; edita uno.
3. Vuelve la conexión → ambos se envían solos; hay exactamente 2 gastos nuevos y los saldos cuadran.
4. Con el viaje cerrado por Pedro mientras Ana estaba offline, su pendiente queda «Requiere atención: viaje cerrado» y
   solo puede descartarse.
5. Ana registra un gasto con Juan → Juan ve la campana con 1 en < 10 s; un gasto privado sin Juan no le notifica.
6. Pedro (participante) exporta Excel y PDF → no aparece el gasto privado de Ana; los saldos coinciden con la app.
   Queda un evento `trip.exported` en la auditoría del viaje.
7. Ana cierra sesión con un pendiente → aviso; tras confirmar, Juan inicia sesión en el mismo navegador y no ve nada
   de Ana.
8. Instalación: Chrome muestra «Instalar»; la app abre en ventana propia y sin red abre el shell.
