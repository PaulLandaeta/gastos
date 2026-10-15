# Lista de lanzamiento del piloto (PRD §15)

Cada condición de la *Definición de terminado del MVP* tiene su evidencia.

- 🤖 Prueba automática en CI
- 📏 Medición registrada
- ✍️ Verificación manual: se firma con fecha al hacerla en producción

| # | Condición del PRD §15 | Evidencia | Tipo | Estado |
|---|---|---|---|---|
| 1 | Los 56 RF están implementados o excluidos de forma expresa | Specs 001–006 (`specs/*/spec.md`). RF-56 en 006 y exclusiones en PRD §2 y la constitution (Principio VIII) | 🤖 + ✍️ | ✅ |
| 2 | Los escenarios críticos financieros y de permisos pasan en CI | `pnpm test` (motor, contratos, API, ops), `pnpm test:rules`, E2E Playwright | 🤖 | ✅ |
| 3 | Total de pagadores = consumo asignado = gasto neto | `packages/finance-engine` (propiedades con fast-check), `tests/routes/expenses*.test.ts` | 🤖 | ✅ |
| 4 | Σ saldos = 0 y la simplificación conserva saldos | Tests de propiedades del motor; `account.test.ts` (también tras la baja) | 🤖 | ✅ |
| 5 | Privacidad validada en cliente, API, Firestore, almacenamiento y exportaciones | `privacy.spec.ts`, `privacy.phase5.test.ts`, `rules.test.ts`, `phase6.rules.test.ts`, `attachments.test.ts`, `exports.test.ts` | 🤖 | ✅ |
| 6 | PWA instalable en Android/iOS; el registro offline se recupera sin duplicados | E2E `pwa/install.spec.ts`, `pwa/offline*.spec.ts`, `expenses.offline.test.ts` | 🤖 | ✅ |
| 6b | Instalación real en un Android y un iPhone del piloto | Seguir `docs/pilot-guide.md`, tarea 1 | ✍️ | ☐ |
| 7 | Facturas procesadas con la IA (OpenAI) con corrección total; una caída de la IA no impide el registro manual | `scan.spec.ts`, `tests/routes/scans.test.ts` (proveedor falso, caída simulada) | 🤖 | ✅ |
| 7b | Escaneo real con OpenAI en producción (3 facturas variadas) | Guía del piloto, tarea 4 | ✍️ | ☐ |
| 8 | Se verifica la eliminación de comprobantes vencidos a los 6 meses | `retention.test.ts`, `retention.spec.ts` | 🤖 | ✅ |
| 8b | El cron de retención corre en producción | Workers → *Triggers* → historial del cron `17 * * * *` | ✍️ | ☐ |
| 9 | Se verifica la anonimización de cuenta | `account.test.ts` (saldos idénticos y 0 PII), `account-deletion.spec.ts` | 🤖 | ✅ |
| 10 | Costos operativos documentados | `docs/operations.md` (límites, consumo, umbrales) | ✍️ | ✅ |
| 11 | Monitoreo documentado y activo | `docs/operations.md`. Workflow `uptime.yml` con `APP_URL`/`API_URL` definidos | ✍️ | ☐ (al desplegar) |
| 12 | Backups y recuperación documentados y probados | `docs/operations.md`, simulacro `apps/ops/tests/restore.test.ts` | 🤖 | ✅ |
| 12b | Primer backup real en B2 y restauración en un emulador | `ops backup` en Actions + `ops restore` local con `FIRESTORE_EMULATOR_HOST` | ✍️ | ☐ |

## Calidad (fase 6)

| Comprobación | Evidencia | Resultado |
|---|---|---|
| Lighthouse móvil, `/login` del build | Job `lighthouse` de CI (`apps/web/scripts/lighthouse.mjs`) | 📏 Rendimiento 87–88 · Accesibilidad 100 · Buenas prácticas 100 |
| WCAG 2.1 AA en las pantallas principales | `a11y.spec.ts` (axe, fases 1–6) | 0 infracciones |
| CPU de la API por petición | `pnpm --filter api perf` | 📏 < 5 ms; anonimización de un viaje de 10 personas ≈ 0,05 ms |
| Baja de una cuenta con 10 viajes | `account.test.ts` (SC-003) | 📏 ≈ 0,2 s (emulador) |
| Exportación de 1.000 gastos | `export.spec.ts` | 📏 ≈ 0,5 s |
| Revisión de seguridad | `docs/security-review.md` | Sin hallazgos bloqueantes |

## Antes de invitar a los usuarios del piloto

- [ ] Despliegue con `pnpm deploy:prod` y smoke test en verde (`docs/deploy.md`).
- [ ] Variables `APP_URL` y `API_URL` y secretos de backup configurados en GitHub. Ejecutar *Backup* y *Uptime* a mano
      una vez.
- [ ] `BACKUP_KEY` guardada también en un gestor de contraseñas.
- [ ] Notificaciones de GitHub Actions activadas para el responsable.
- [ ] Aviso de privacidad del piloto enviado a los participantes (sección «Privacidad» de `docs/pilot-guide.md`).
- [ ] Filas ✍️ de esta tabla firmadas.
