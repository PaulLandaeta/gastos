# Access Rules — Fase 6

| Ruta | Lectura | Escritura |
|---|---|---|
| `trips/{t}` y todas sus subcolecciones | `isMember(t)` exige además `members/{uid}.deletedAt == null` | denegada (API) |
| `accountDeletions/{uid}` | denegada | denegada (API) |
| `ops/{doc}` | denegada | denegada |
| `users/{uid}/**` | sin cambios (dueño). Tras la baja, los documentos no existen. | denegada |

Tests nuevos (negativos):
- un miembro eliminado no lee el viaje, sus miembros, gastos, pagos ni categorías;
- nadie lee `accountDeletions`.
