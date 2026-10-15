# Quickstart: probar el modo picante (feature 007)

## Local (emuladores)

```bash
pnpm emulators                 # Auth + Firestore
pnpm --filter api dev          # API en :8787
pnpm --filter web dev          # web
```

1. Entra como Ana (creadora) y crea un viaje en EUR con Beto, Carla, Dani y Eva.
2. Registra gastos para llegar a: Beto −120, Carla −70, Dani −15, Ana +150, Eva +55.
3. Sin activar nada, abre el viaje con cualquiera: **no** aparece el ranking (FR-003).
4. Como Ana, activa «Modo picante» en el viaje.
5. Como Dani (participante): ves el ranking — Beto «La más zorra del grupo», Carla «Golfa barata», Dani «Señorita»,
   Ana y Eva «Macho caporal», cada uno con su frase.
6. Cambia a «Directa» y a «Transitiva»: cambian las relaciones «X es la zorra de Y», no las etiquetas.
7. Como Dani, intenta activar/desactivar: no hay opción; un `PATCH` manual devuelve 403.
8. Registra y confirma un pago de Beto a Ana por 120: el ranking se actualiza (Carla pasa a ser la más zorra).
9. Como Ana, desactiva el modo picante: el ranking desaparece para todos.

## Tests

```bash
pnpm --filter finance-engine test       # propiedades de roastRanking
pnpm --filter api test                  # PATCH spicyMode (roles, auditoría, conflictos)
pnpm --filter web test                  # frases y modelo de la tarjeta
pnpm --filter web test:e2e -g "modo picante" # flujo completo + axe
```
