# Performance / CPU budget: 001-finance-engine-trips

**Límite**: Cloudflare Workers Free = 10 ms de CPU por request (el tiempo de espera de I/O no cuenta).

## Medición local (Node 24, mismo V8 que workerd) — `pnpm --filter api perf`

Peor caso de `POST /trips/{id}/expenses`: gasto de 100 ítems × 50 miembros.

| Tramo | Mediana |
|---|---|
| Verificación del ID token (RS256, JWKS en caché) | 0,06 ms |
| Decodificación de viaje + 50 miembros (Firestore REST) | 0,04 ms |
| Motor: `computeExpense` + ledger + ambas vistas + codificación | 1,27 ms |
| **Total CPU estimado** | **≈ 1,4 ms** (umbral del test: 5 ms) |

El test falla si el total supera 5 ms (50 % de margen).

- El motor por sí solo: < 2 ms de mediana (`packages/finance-engine/tests/perf/expense.perf.test.ts`).
- El token OAuth de la service account (firma RS256) se cachea por isolate ~55 min, así que no cuenta en cada request.

## Por qué no se mide dentro de workerd

workerd congela `performance.now()`/`Date.now()` entre operaciones de I/O (mitigación Spectre), así que un test
dentro del runtime no puede medir CPU. La medición se hace en Node con el mismo código.

## Verificación en producción (pendiente de despliegue)

- [ ] Tras el primer despliegue, revisar *Workers → Metrics → CPU time* (p50/p99) en el dashboard de Cloudflare, o
      `wrangler tail --format json` (campo `cpuTime`). Objetivo: p99 < 5 ms.
- [ ] Revisar las lecturas y escrituras diarias de Firestore frente a lo estimado en `research.md` R12.
