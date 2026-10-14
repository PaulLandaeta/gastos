# Contrato de acceso: Security Rules — cambios de la feature 005

| Ruta | Lectura permitida a | Escritura | Denegado (test negativo obligatorio) |
|---|---|---|---|
| `users/{uid}/notifications/{n}` | `request.auth.uid == uid` (get y list) | nadie (solo API) | otro usuario (incluido el gestor del viaje), anónimo, cualquier escritura del cliente |

Sin cambios en el resto de rutas. La caché offline del SDK solo contiene documentos que las Rules ya permitieron leer,
por eso la caché nunca amplía la visibilidad (FR-009): al reconectar, los listeners rechazados por permisos eliminan
el documento de la vista.
