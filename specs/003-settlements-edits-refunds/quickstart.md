# Quickstart: 003-settlements-edits-refunds

Arranque y prerrequisitos: igual que [001](../001-finance-engine-trips/quickstart.md) (`pnpm emulators`, API en
:8787, web en :5180).

## Tests

```bash
pnpm test                    # motor (refundEffect, itemRefundable, balancesPreview) + API (pagos, edición, preview, restauración, devoluciones)
pnpm test:rules              # settlements y refunds
pnpm --filter web test:e2e   # pagos, conflicto de edición, previsualización, restauración, devoluciones
```

## Recorrido de aceptación (Ana creadora, Pedro y Juan, USD)

1. **Pago pendiente no afecta saldos (PRD)**: Pedro paga 40.00 un gasto personal de Ana → Ana debe
   40.00. Ana registra un pago de 20.00 a Pedro → sigue debiendo 40.00. Pedro confirma → Ana debe
   20.00. Un segundo pago de 5.00 que Pedro rechaza («no lo recibí») no cambia nada.
2. **Pagar desde la propuesta**: en «Vista simplificada», Ana pulsa «Pagar» en «Ana → Pedro 20.00»
   → formulario prellenado → Pedro confirma → saldos en cero.
3. **Conflicto de edición (PRD)**: Ana y Juan (admin) abren el mismo gasto (versión N). Ana
   guarda la descripción «Cena (ajustada)»; Juan guarda otro importe → recibe «Otra persona
   modificó el gasto» con la lista de diferencias; su borrador sigue en el formulario.
4. **Previsualización**: con pagos confirmados en el viaje, Ana edita el importe de un gasto →
   aparece «Impacto en saldos» (antes, después, diferencia por persona) → Confirmar aplica.
5. **Restaurar**: Ana anula un gasto (previsualización) y lo restaura → saldos idénticos a antes.
6. **Devolución**: ítem «Vino» cantidad 3 por 30.00 compartido Ana/Pedro; Pedro registra la
   devolución de 1 unidad recibida por él → sugerido 10.00 (+ parte de impuestos si los hubo) →
   guardar → Ana y Pedro consumen 5.00 menos cada uno; Pedro recibió los 10.00 y ahora debe 5.00 a Ana; intentar
   devolver 3 unidades más → «máximo disponible: 2 unidades».
