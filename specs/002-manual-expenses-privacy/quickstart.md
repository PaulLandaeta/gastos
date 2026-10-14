# Quickstart: 002-manual-expenses-privacy

Prerrequisitos, instalación y arranque: igual que
[`specs/001-finance-engine-trips/quickstart.md`](../001-finance-engine-trips/quickstart.md)
(`pnpm emulators`, `pnpm --filter api dev`, `pnpm --filter web dev` en :5180).

## Tests

```bash
pnpm test                    # motor + contratos (parseMoneyInput) + API (gastos v2, categorías, stats, duplicados)
pnpm test:rules              # privacidad de gastos, categorías y proyecciones
pnpm --filter web test:e2e   # registro manual, factura por ítems, privacidad, dashboard, duplicados, a11y
```

## Recorrido de aceptación (Ana creadora, Pedro y Juan participantes, USD)

1. Ana crea «Uyuni», invita a Pedro y Juan; ambos aceptan. En el inicio del viaje se ven
   «Registro manual» (activo) y «Escanear factura» (deshabilitado, «Próximamente»).
2. **Simple**: Ana → Registro manual → USD 10.00 «Cena», Comida, Ana/Pedro/Juan a partes
   iguales → Guardar (< 30 s). Saldos: Ana +6.66, Pedro −3.33, Juan −3.33.
3. **Factura mixta**: Pedro registra «Súper» por ítems: Pan 6.00 y Agua 3.00 compartidos
   Ana/Pedro (asignación en lote), Champú 12.00 personal de Ana, impuesto 2.10 proporcional, dos
   pagadores (Pedro 15.00, Ana 8.10). Mientras no cuadra, la barra inferior muestra la diferencia y
   «Guardar» está deshabilitado.
4. **Privacidad**: Juan abre la lista → no ve «Súper»; un enlace directo a su detalle muestra «No
   encontrado». Ve el total compartido del viaje y los saldos de todos.
5. **Personales**: Ana → pestaña Personales → ve «Súper» con 12.00 + su parte del impuesto; el total
   compartido del viaje no incluye esa parte.
6. **Duplicado**: Ana repite «Cena» USD 10.00 el mismo día → aviso «Posible duplicado» con el gasto
   anterior → Cancelar conserva el formulario; Confirmar lo guarda.
7. **Anular**: Ana abre el duplicado → Anular → confirmar → los saldos vuelven al paso 6; el
   historial muestra creación y anulación con autor y fecha. Juan no ve la acción «Anular».
8. **Categorías**: Ana crea «Excursiones»; Juan no puede crear categorías; Ana desactiva
   «Compras» → ya no se ofrece en el formulario.
9. **Dashboard y filtros**: filtrar por categoría Comida y rango de fechas → lista, totales y
   gráfico coinciden.
