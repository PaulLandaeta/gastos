# Revisión de seguridad previa al piloto (FR-030)

**Fecha**: 2026-10-14 · **Alcance**: features 001–006 · **Método**: revisión manual guiada del código, las reglas y la
configuración, más la evidencia automática de los tests indicados.

Leyenda: ✅ correcto · 🔧 corregido en esta revisión · ⚠️ riesgo aceptado (con justificación)

## 1. Autenticación

| Punto | Estado | Evidencia |
|---|---|---|
| Toda ruta `/v1/*` exige un ID token de Firebase verificado (firma RS256 contra JWKS de Google, `iss`, `aud`, `exp`, `auth_time`, solo `google.com`) | ✅ | `apps/api/src/index.ts`, `auth/verifyIdToken.ts`; `tests/auth/verifyIdToken.test.ts`, `tests/security.test.ts` |
| Excepciones públicas: `GET /v1/health` (sin datos) y `/local-blobs/*` (solo con emulador) | ✅ | `index.ts` |
| El modo emulador (tokens sin firma) exige `ENVIRONMENT=emulator` **y** un proyecto `demo-*` | ✅ | `env.ts` (`isEmulator`) |
| Las operaciones sensibles exigen un inicio de sesión reciente: la baja pide ≤ 5 min | 🔧 | `services/accountDeletion.ts`; `tests/routes/account.test.ts` (`REAUTH_REQUIRED`) |

## 2. Autorización y privacidad (RF-38/RF-39)

| Punto | Estado | Evidencia |
|---|---|---|
| Las reglas de Firestore niegan todo por defecto; el cliente nunca escribe | ✅ | `firebase/firestore.rules`; `firebase/tests/*.rules.test.ts` (38 tests) |
| El detalle de un gasto solo lo ven sus `viewerUids` o los gestores, con la misma función en reglas, API, exportaciones y notificaciones | ✅ | `visibility.ts`, `visibility-parity.test.ts`, `privacy.phase5.test.ts` |
| Un miembro dado de baja pierde el acceso al instante aunque su token siga vigente (≤ 1 h) | 🔧 | Reglas: `isMember` exige `deletedAt == null` (`phase6.rules.test.ts`). API: `loadTripForMember`, y `ACCOUNT_DELETED` en `me/sync`, al crear viaje y al aceptar invitación |
| Pagos en nombre de un eliminado: solo gestores, y solo si la contraparte está eliminada | 🔧 | `settlements.ts`; `tests/routes/settlements.test.ts` |
| Roles: solo el creador cambia admins; el traspaso automático del creador al darse de baja queda en auditoría | ✅/🔧 | `roles.ts`, `accountDeletion.ts` |

## 3. Datos personales y RF-56

| Punto | Estado | Evidencia |
|---|---|---|
| Tras una baja, ningún documento contiene el nombre ni el correo del usuario (búsqueda exhaustiva) | 🔧 | `tests/routes/account.test.ts` (SC-002) |
| Los saldos del grupo no cambian (Σ = 0) | 🔧 | ídem (SC-001) y E2E `account-deletion.spec.ts` |
| Una restauración de backup no resucita datos personales de bajas posteriores | 🔧 | `apps/ops/tests/restore.test.ts` |
| La auditoría guarda los correos enmascarados (`a***@dominio`) y nunca nombres | ✅ | `services/audit.ts` (`redact`) |
| Descripciones y notas libres escritas por quien se da de baja se conservan como registro financiero del grupo | ⚠️ | Decisión de la spec 006 (Assumptions); se informa en la guía del piloto |
| PRD #7: en viajes de 2–3 personas, los saldos públicos pueden dejar inferir importes de gastos privados | ⚠️ | Inherente a RF-39 (los saldos son públicos dentro del viaje). Se documenta en la guía del piloto |

## 4. Archivos y exportaciones

| Punto | Estado | Evidencia |
|---|---|---|
| Comprobantes en bucket B2 privado; acceso solo con URLs firmadas de corta duración tras autorizar | ✅ | `services/attachments.ts` (`DOWNLOAD_URL_TTL_SECONDS`), `tests/routes/attachments.test.ts` |
| Validación de tipo, tamaño y páginas antes de emitir una URL de subida | ✅ | `services/uploads.ts` |
| Exportaciones filtradas en servidor con `Cache-Control: no-store`; el archivo se genera en el navegador y no se almacena | ✅ | `routes/exports.ts`, `privacy.phase5.test.ts` |
| Backups cifrados (AES-256-GCM) en un bucket aparte; la clave solo está en los secretos de GitHub y en un gestor de contraseñas | 🔧 | `apps/ops/src/crypto.ts`, `crypto.test.ts` |
| Los backups contienen PII hasta 35 días | ⚠️ | Retención mínima razonable para recuperar desastres; se informa en la política del piloto |

## 5. Navegador

| Punto | Estado | Evidencia |
|---|---|---|
| CSP restrictiva: `default-src 'self'`, sin `unsafe-eval`, `object-src 'none'` y `connect-src` limitado a la API, Firebase y B2 | 🔧 | `apps/web/config/csp.ts`, `tests/unit/csp.test.ts`, E2E `pwa/csp.spec.ts` (sin violaciones) |
| `style-src 'unsafe-inline'` | ⚠️ | Necesario para los atributos `style` de React y el iframe de Firebase Auth. Sin scripts inline, el riesgo de inyección de estilos es bajo |
| Zod sin `new Function` (`jitless`), para no necesitar `unsafe-eval` | 🔧 | `apps/web/src/zodConfig.ts` |
| Cabeceras de Hosting: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (cámara solo propia) y COOP `same-origin-allow-popups` | 🔧 | `firebase.json`, comprobado por `ops smoke` |
| CORS de la API con lista blanca exacta de orígenes | ✅ | `index.ts`; `ops smoke` comprueba aceptación y rechazo |
| Datos locales por cuenta, borrados al cerrar sesión o darse de baja | ✅/🔧 | `lib/cacheOwner.ts`, `AuthProvider.tsx` |

## 6. Abuso y disponibilidad

| Punto | Estado | Evidencia |
|---|---|---|
| Rate limiting: 120 peticiones por minuto y usuario, 60 por minuto e IP en rutas públicas | 🔧 | `http/rateLimit.ts`, `tests/http/rateLimit.test.ts` |
| El límite es por ubicación de Cloudflare y aproximado | ⚠️ | Suficiente para frenar ráfagas. Las cuotas de IA son atómicas aparte (RF-51) |
| La cuota agotada se traduce a 503 `SERVICE_UNAVAILABLE` con `Retry-After`; la app no pierde lo escrito | 🔧 | `tests/ops.test.ts`, `tests/unit/errors.test.ts` |

## 7. Secretos, logs y dependencias

| Punto | Estado | Evidencia |
|---|---|---|
| Sin secretos en el repositorio (búsqueda de claves API, claves privadas y tokens) | ✅ | `git grep` limpio. `.env*` y `.gcp-sa.json` están en `.gitignore` |
| Secretos solo en Wrangler Secrets y GitHub Secrets; el workflow de despliegue borra las credenciales temporales | ✅ | `deploy.yml` |
| Logs estructurados sin correos, nombres, importes ni ids en las rutas | 🔧 | `http/requestLog.ts`, `tests/ops.test.ts` (SC-009) |
| Los logs de Actions (repo público) solo muestran recuentos y nunca datos | ✅ | `apps/ops/src/cli.ts` imprime solo mensajes y nunca stacks |
| `pnpm audit --prod`: `@grpc/grpc-js` < 1.13.6 (alta, solo en el SDK de Firestore para Node) | 🔧 | Override `^1.13.7` en `package.json`; auditoría limpia |
| Gemini en nivel gratuito: Google puede usar el contenido para mejorar sus productos | ⚠️ | Riesgo registrado en la constitution, con aviso en el consentimiento de escaneo. Decidir un nivel de pago u otro proveedor antes de abrir más allá del piloto |

## Hallazgos pendientes

Ninguno bloqueante para el piloto. Los ⚠️ quedan aceptados con su justificación y se revisan al cerrar el piloto.
