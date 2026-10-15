# Quickstart: 006-hardening-pilot

## Local

El entorno es igual que en la 005:
- emuladores con `pnpm emulators`;
- API en el puerto 8787 con `--env emulator`;
- web en el puerto 5180 y `vite preview` en el 5181.

```bash
pnpm test && pnpm test:rules && pnpm --filter api perf
pnpm --filter ops test              # backup/restore/preflight contra el emulador
pnpm --filter web test:e2e          # incluye la baja de cuenta y la CSP sobre el build
pnpm --filter ops ops smoke -- --app http://localhost:5181 --api http://localhost:8787
```

## Recorrido de aceptación

1. Ana (creadora), Pedro y Juan comparten un viaje con gastos, ítems, un pago confirmado y una devolución. Anota los
   saldos.
2. Pedro registra un pago a Juan sin confirmar y abre Cuenta → «Borrar mi cuenta». El resumen muestra el bloqueo por
   pago pendiente.
3. Juan confirma el pago. Pedro vuelve y ve su saldo por viaje y los comprobantes que se borrarán. Escribe «BORRAR» y
   confirma.
4. Pedro queda fuera de la sesión. Ana ve «Participante eliminado 1» con el mismo saldo y Σ saldos = 0.
5. Juan registra un pago al participante eliminado y Ana (gestora) lo confirma. El saldo se liquida.
6. Pedro vuelve a entrar con Google: no ve ningún viaje.
7. Ejecuta `pnpm --filter ops ops backup` con `BACKUP_DIR` y luego `restore` sobre un emulador vacío. Los recuentos y
   los saldos coinciden.

## Producción

La guía completa está en `docs/deploy.md`. En resumen:
1. Crea los proyectos y los secretos.
2. Ejecuta `pnpm --filter ops ops preflight`.
3. Ejecuta `pnpm deploy:prod`.
4. El `smoke` se ejecuta solo al final del despliegue.
