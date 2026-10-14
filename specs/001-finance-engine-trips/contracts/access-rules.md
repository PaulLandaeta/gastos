# Contrato de acceso: Firestore Security Rules (lecturas cliente)

Deny-by-default. **Ninguna escritura desde cliente** (`allow write: if false` en todo). Cada
fila es un test obligatorio en `firebase/tests/rules.test.ts` (positivo y negativo).

| Ruta | Lectura permitida a | Denegado (test negativo) |
|---|---|---|
| `users/{uid}` | `request.auth.uid == uid` | otro usuario autenticado; anónimo |
| `users/{uid}/trips/{tripId}` | `request.auth.uid == uid` | otro usuario |
| `trips/{tripId}` | miembro aceptado (`exists(members/{auth.uid})`) | usuario sin vínculo; invitado aún no aceptado |
| `trips/{tripId}/members/{key}` | miembro aceptado: todas las filas | invitado no aceptado; ajeno |
| `invitations/{email}/trips/{tripId}` | `token.email.lower() == email && token.email_verified` (contiene el resumen del viaje que ve el invitado) | email distinto; no verificado |
| `trips/{tripId}/expenses/**` | nadie en 001 — **sustituido por 002** (lectura por `viewerUids` o rol admin/creador) | ver `specs/002-manual-expenses-privacy/contracts/access-rules.md` |
| `trips/{tripId}/projections/**` | nadie (vía API) | miembro |
| `trips/{tripId}/auditEvents/**` | nadie | miembro, creador |
| `idempotencyKeys/**` | nadie | cualquiera |
| cualquier otra ruta | nadie | — |

Notas:
- El invitado no lee `trips/{tripId}` ni `members` hasta aceptar: todo lo que necesita (nombre del
  viaje, fechas, moneda, quién invita) está desnormalizado en su documento de `invitations`.
- `members/{uid}` existe solo para aceptados, por lo que `exists(.../members/$(request.auth.uid))`
  es la única condición de membresía en Rules.
