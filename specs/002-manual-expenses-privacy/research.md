# Research: Gastos manuales, privacidad y dashboard (Fase 2)

**Feature**: `002-manual-expenses-privacy` · **Fecha**: 2026-10-13 · **Base**: feature 001.

## R1. Privacidad por documento con lecturas del cliente

- **Decision**: cada gasto guarda `viewerUids` = pagadores ∪ beneficiarios ∪ autor, inmutable (sin
  edición en Fase 2). Security Rules permiten `get`/`list` de `trips/{t}/expenses/{e}` si el usuario
  es miembro aceptado **y** (`request.auth.uid in resource.data.viewerUids` **o** su fila de miembro
  tiene rol `creator`/`admin`, leída en vivo con `get()`). Las consultas de participantes normales
  incluyen `where('viewerUids', 'array-contains', uid)`; las de admin/creador no.
- **Rationale**: las Rules no filtran campos, pero sí documentos (constitution II). Como la
  aclaración Q2 da acceso al gasto completo a quien puede verlo, no hace falta separar detalle y
  resumen en documentos distintos. La comprobación de rol en vivo cumple el caso límite «quien pierde
  el rol de admin deja de ver al instante». La API aplica la misma función de visibilidad
  (`canViewExpense`) en historial, anulación y duplicados (FR-017).
- **Alternatives considered**: (a) gastos solo por API (sin lecturas de cliente): privacidad en un
  único punto, pero cada vista consume requests de Workers y lecturas sin caché del SDK; (b) documento
  público + subdocumento privado: innecesario tras Q1 (los ajenos no se listan) y Q2.

## R2. Agregados sin recorrer gastos (dashboard)

- **Decision**: proyecciones incrementales actualizadas en la misma transacción que crea/anula el
  gasto (mismo patrón que `projections/ledger` de 001):
  - `trips/{t}/projections/public` → `sharedTotalMinor`, `expenseCount`.
  - `trips/{t}/projections/categories` → gasto compartido por categoría de todo el viaje.
  - `trips/{t}/memberStats/{uid}` → aporte, consumo compartido, consumo personal, total global y
    gasto compartido por categoría **de los gastos que ese usuario puede ver**.
  - Ninguna es legible por Rules: el dashboard las obtiene con `GET /trips/{t}/stats`, que aplica
    Q3 y FR-026 según el rol (una sola vía de lectura, menos superficie).
- **Rationale**: dashboard sin filtros = 1 request con ≤ 6 lecturas, sin importar si hay 1.000
  gastos (SC-008, constitution VI). Los totales por persona de otros solo los ve admin (FR-026).
- **Filtros**: con filtros (fecha/categoría/persona/pagador), la vista se calcula en el cliente
  sobre los gastos visibles del rango: consulta por `transactionDate` (y `categoryId ==` si aplica)
  y filtro de persona/pagador en memoria. Firestore solo admite un `array-contains` por consulta y
  los participantes ya usan `viewerUids`. Coste acotado por el rango elegido.

## R3. Validación en vivo idéntica a la del servidor (FR-011, SC-003)

- **Decision**: el formulario ejecuta `computeExpense` de `packages/finance-engine` en el navegador
  en cada cambio (con `seq` provisional `trip.expenseSeq + 1`) y muestra reparto, diferencia e
  ítems sin beneficiario. El servidor recalcula con el `seq` real asignado en la transacción.
- **Rationale**: un único motor, cero divergencia de reglas. El reparto de residuos puede variar
  solo si otro gasto se registra en paralelo (cambia `seq` y por tanto la rotación); la respuesta
  devuelve los cargos definitivos y la UI los muestra. Coste: < 2 ms por cálculo (perf de 001).

## R4. Entrada de importes sin flotantes

- **Decision**: `parseMoneyInput(text, decimals, locale)` en `packages/contracts` convierte la
  cadena a entero en unidad menor con aritmética de cadenas: acepta `,` o `.` como separador
  decimal según el idioma, separadores de miles solo si son inequívocos, rechaza más decimales de
  los de la moneda. Inverso: `formatMoney` (001).
- **Rationale**: constitution I (nunca `float`); el teclado decimal de móviles varía por idioma.

## R5. Duplicados (FR-031/032)

- **Decision**: en la transacción de alta, después de la comprobación de idempotencia, la API
  consulta gastos vigentes con mismo `transactionDate` y `totalMinor` (índice compuesto) y comprueba
  intersección de `payerUids`. Si hay coincidencia y el cuerpo no trae `confirmDuplicate: true` →
  `409 POSSIBLE_DUPLICATE` con el resumen del gasto parecido **solo si el usuario puede verlo**;
  si no, solo el aviso genérico (no se filtra información de un gasto ajeno).
- **Rationale**: la idempotencia se evalúa antes, así un reintento idéntico nunca ve el aviso.

## R6. Categorías

- **Decision**: `trips/{t}/categories/{id}`; 6 categorías iniciales con id determinista
  (`default-lodging`, `default-transport`, `default-food`, `default-activities`,
  `default-shopping`, `default-other`) creadas en `createTrip`. Viajes previos sin categorías: el
  alta de gasto con un id `default-*` las siembra en la misma transacción. Altas y cambios solo por
  API (creador/admin); nombre único (sin distinguir mayúsculas) dentro del viaje; no se borran.

## R7. Historial del gasto (FR-030)

- **Decision**: `GET /trips/{t}/expenses/{e}/history` en la API: valida `canViewExpense` y
  devuelve los `auditEvents` con `entityId == expenseId` (índice `entityId`+`timestamp`). Los
  eventos de auditoría siguen sin ser legibles por Rules.

## R8. UI y gráfico

- **Decision**: formulario en una sola página con secciones plegables (Básico · Reparto · Ajustes ·
  Pagadores) y barra inferior fija con total, diferencia y botón Guardar. Gráfico por categoría como
  barras horizontales HTML/CSS con etiquetas y tabla accesible (sin librería de gráficos: menos
  bundle, WCAG AA). Navegación: inicio del viaje con accesos rápidos → `/trips/:id/expenses/new`,
  lista `/trips/:id/expenses` (pestañas Compartidos/Personales), detalle `/trips/:id/expenses/:eid`,
  categorías `/trips/:id/categories`.

## R9. Presupuesto free tier (4 personas, ~300–1.000 gastos)

| Operación | Lecturas | Escrituras |
|---|---|---|
| Alta de gasto | trip + miembros + ledger + 2 proyecciones + idem + duplicados (≤ 3) + categoría ≈ 12 | gasto, trip, ledger, 2 proyecciones, idem, audit, memberStats × involucrados (≤ 4) ≈ 11 |
| Dashboard sin filtros | 3 (public, memberStats propio o categories, ledger vía API) | 0 |
| Lista (página) | 50 | 0 |
| Dashboard filtrado | gastos del rango (≤ 1.000) | 0 |

Con 4 usuarios, 40 altas/día y 50 vistas/día: < 10 % de lecturas y < 3 % de escrituras diarias.
