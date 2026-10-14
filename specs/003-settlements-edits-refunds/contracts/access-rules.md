# Contrato de acceso: Security Rules — cambios de la feature 003

Base: 001 y 002 (deny-by-default, sin escrituras desde cliente).

| Ruta | Lectura permitida a | Denegado (test negativo obligatorio) |
|---|---|---|
| `trips/{t}/settlements/{s}` | `isMember(t)` | ajeno, invitado |
| `trips/{t}/expenses/{e}/refunds/{r}` | `isMember(t) && (auth.uid in get(expense).viewerUids \|\| isManager(t))` | miembro no involucrado en el gasto padre; ajeno |
| escrituras en settlements y refunds | nadie (vía API) | cualquier miembro |
