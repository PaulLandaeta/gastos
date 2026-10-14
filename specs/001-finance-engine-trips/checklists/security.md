# Security Review: 001-finance-engine-trips

**Fecha**: 2026-10-13 · **Alcance**: Security Rules, verificación de tokens, API (Workers), respuestas de error y logs.
**Resultado**: sin hallazgos abiertos de severidad alta. 4 endurecimientos aplicados con tests.

## Verificado

- [x] Rules deny-by-default: ninguna escritura desde cliente en ninguna ruta (`firebase/tests/rules.test.ts`).
- [x] Lecturas mínimas: perfil e índice propios; viaje y miembros solo para miembros aceptados; invitaciones solo
      con correo verificado coincidente; gastos, proyecciones, auditoría e idempotencia ilegibles (tests negativos).
- [x] ID tokens: firma RS256 contra JWKS de Google, `iss`/`aud`/`exp`/`auth_time`/`sub`, solo proveedor `google.com`.
- [x] Sin fugas de existencia: viajes ajenos e invitaciones de otro correo → 404 (no 403).
- [x] Toda mutación revalida membresía, rol, estado y versión dentro de la misma transacción.
- [x] Idempotencia con alcance `{tripId}_{uid}_{key}`: un usuario no puede reutilizar la clave de otro.
- [x] Errores internos → `INTERNAL` genérico con `x-correlation-id`; los detalles solo van a logs.
- [x] CORS restringido a `ALLOWED_ORIGINS`.
- [x] Secretos: la service account solo existe como secret de Workers (`FIREBASE_SERVICE_ACCOUNT`); nada en el repo.

## Endurecimientos aplicados en esta revisión

| # | Riesgo | Corrección | Test |
|---|---|---|---|
| S1 | Un despliegue mal configurado con `ENVIRONMENT=emulator` aceptaría tokens sin firma | El modo emulador exige además un proyecto `demo-*` (no puede acceder a recursos reales) | `tests/auth/verifyIdToken.test.ts` |
| S2 | Mensajes de error de Firestore con rutas `invitations/{email}` podían llegar a los logs | `log()` enmascara correos (`a***@dominio`) igual que la auditoría | `tests/security.test.ts` |
| S3 | Parámetros de URL decodificados (`%2F`) podían alterar la ruta del documento | `assertSafeId` restringe `tripId`/`expenseId` a `[A-Za-z0-9_-]{1,128}` → 404 | `tests/security.test.ts` |
| S4 | Un correo con `/` rompería la ruta del índice de invitaciones | El esquema `Email` lo rechaza (verificado) | `tests/security.test.ts` |

## Riesgos aceptados / diferidos

- Rate limiting por usuario: diferido a Fase 6 (hardening), quitado del contrato (G1 de `/speckit-analyze`).
- App Check: no configurado en el MVP (requiere registro de la app; evaluar en Fase 6).
- Los miembros aceptados ven los correos de los demás participantes del viaje (necesario para identificarse).
- Gemini free tier y privacidad de recibos: fuera de alcance de esta feature (Fase 4), sigue como decisión pendiente.
- Recomendado antes de producción: ejecutar `/security-review` sobre la rama completa.
