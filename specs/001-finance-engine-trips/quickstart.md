# Quickstart: 001-finance-engine-trips

Guía para levantar y validar la feature en local. Todo corre contra emuladores; no requiere
cuentas de pago.

## Prerrequisitos

| Herramienta | Versión | Comprobación |
|---|---|---|
| Node | 24.x | `node -v` |
| pnpm | 10.x | `pnpm -v` |
| Java | **21+** (requerido por Firebase Emulator Suite) | `java -version` → instalar: `brew install openjdk@21` y añadir a `PATH` |
| firebase-tools | 15.x | `firebase --version` |
| Wrangler | 4.x (dependencia del workspace) | `pnpm --filter api exec wrangler --version` |

## Configuración inicial (una vez)

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local      # VITE_FIREBASE_* + VITE_API_URL=http://localhost:8787/v1
npx playwright install chromium                   # solo para los E2E
cp apps/api/.dev.vars.example apps/api/.dev.vars  # ENVIRONMENT=emulator, FIREBASE_PROJECT_ID=demo-gastos
```

El proyecto de emulador usa el prefijo `demo-` (no requiere proyecto real de Firebase).

## Ejecutar

```bash
pnpm emulators          # Auth :9099, Firestore :8080 (usa Java 21 de $JAVA21_HOME, por defecto /opt/homebrew/opt/openjdk@21)
pnpm --filter api dev   # Worker en :8787 apuntando a los emuladores
pnpm --filter web dev   # PWA en :5180
```

## Validar (tests obligatorios)

```bash
pnpm --filter finance-engine test        # unit + propiedades (fast-check), cobertura ≥ 95 %
pnpm test:rules                          # Security Rules en emulador (contracts/access-rules.md)
pnpm --filter api test                   # API en workerd contra emulador (contracts/http-api.md)
pnpm --filter web test:e2e               # Playwright (arranca wrangler dev y vite): login, viajes, roles, ciclo de vida, a11y
pnpm --filter api perf                   # presupuesto de CPU por request (< 5 ms; límite Workers 10 ms)
pnpm lint && pnpm typecheck
```

## Recorrido manual de aceptación

> Verificado el 2026-10-13: pasos 1, 2, 4, 7 y 8 por E2E (Playwright) y pasos 2–8 por API contra `wrangler dev` + emuladores.

1. Abrir `http://localhost:5180`, iniciar sesión con un usuario del Auth Emulator
   (`ana@example.com`, email verificado).
2. Crear viaje "Uyuni", USD, 2026-11-01 → 2026-11-05, invitando a `pedro@example.com` y
   `juan@example.com` → el viaje aparece como **Pendiente**.
3. Con la API, intentar registrar un gasto → `409 TRIP_NOT_READY`.
4. En otra ventana privada, entrar como `pedro@example.com` → ver invitación → aceptar.
   Repetir con `juan@example.com` → el viaje pasa a **Activo**.
5. Registrar por API un gasto de USD 10.00 pagado por Ana, en partes iguales entre los 3 (es el
   gasto n.º 1) → consumo: Ana 3.34 (primera por orden de entrada), Pedro 3.33, Juan 3.33;
   saldos: Ana +6.66, Pedro −3.33, Juan −3.33 (suma cero).
6. Anular el gasto → saldos en cero; intentar cambiar la moneda a BOB → `409 CURRENCY_LOCKED`;
   intentar invitar a otro correo → `409 PARTICIPANTS_LOCKED`.
7. Ana promueve a Pedro a admin; Pedro intenta promover a Juan → `403 FORBIDDEN`.
8. Pedro cierra el viaje → solo lectura; Pedro intenta archivar → `403 FORBIDDEN`;
   Ana archiva y restaura → vuelve a **Cerrado**.

Ejemplo de llamada (token del emulador obtenido desde la PWA en DevTools):

```bash
curl -s -X POST http://localhost:8787/v1/trips/$TRIP/expenses \
  -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"description":"Cena","transactionDate":"2026-11-01","totalMinor":1000,
       "payers":[{"uid":"'$ANA'","amountMinor":1000}],"splitMode":"total",
       "items":[{"id":"t","index":0,"description":"Total","grossMinor":1000,"discountMinor":0,
       "classification":"shared","beneficiaries":["'$ANA'","'$PEDRO'","'$JUAN'"],
       "allocation":{"mode":"equal"}}],"adjustments":[]}'
```
