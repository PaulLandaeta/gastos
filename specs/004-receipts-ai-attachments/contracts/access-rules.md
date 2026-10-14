# Contrato de acceso: Security Rules — cambios de la feature 004

| Ruta | Lectura permitida a | Denegado (test negativo obligatorio) |
|---|---|---|
| `trips/{t}/expenses/{e}/attachments/{a}` | como el gasto padre (`viewerUids` o gestor) | no involucrado, ajeno |
| `trips/{t}/settlements/{s}/attachments/{a}` | emisor o receptor del pago, o gestor | otro miembro, ajeno |
| `trips/{t}/uploads/{u}` | `resource.data.uploadedBy == auth.uid` | otro miembro (incluido gestor) |
| `trips/{t}/scans/{s}` | `resource.data.requestedBy == auth.uid` | otro miembro |
| `trips/{t}/aiUsage/**`, `aiUsage/**` | nadie | cualquiera |

Los archivos en sí nunca se leen desde Firestore: solo mediante URLs firmadas de 15 min que emite la
API tras validar permisos.
