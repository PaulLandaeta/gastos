# Contrato de acceso: Security Rules — cambios de la feature 002

Base: `specs/001-finance-engine-trips/contracts/access-rules.md` (sigue vigente: deny-by-default,
ninguna escritura desde cliente). `isMember(t)` = existe `trips/{t}/members/{auth.uid}`;
`isManager(t)` = esa fila tiene `role in ['creator','admin']` (leída en vivo con `get()`).

| Ruta | Lectura permitida a | Denegado (test negativo obligatorio) |
|---|---|---|
| `trips/{t}/expenses/{e}` (get) | `isMember(t) && (auth.uid in viewerUids \|\| isManager(t))` | miembro no involucrado; ex-admin tras ser degradado; ajeno; invitado |
| `trips/{t}/expenses` (list) | consulta con `viewerUids array-contains auth.uid`, o sin filtro si `isManager(t)` | participante normal consultando sin filtro `array-contains` |
| `trips/{t}/categories/{c}` | `isMember(t)` | ajeno, invitado |
| `trips/{t}/projections/*` (public, categories, ledger) | nadie (dashboard vía `GET /stats`) | miembro, admin, creador |
| `trips/{t}/memberStats/{uid}` | nadie (vía `GET /stats`) | el propio usuario, admin |
| `trips/{t}/auditEvents/**` | nadie (historial vía API) | cualquiera |

Escenario crítico del PRD cubierto (§6.1 «Usuario sin acceso al comprobante privado»): Juan no
pagador, no beneficiario, no admin → `get` del gasto denegado, `list` sin `array-contains` denegado,
`GET …/history` → 404. Solo ve el total compartido (`GET /stats`) y los saldos (API).
