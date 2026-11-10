# ms-imagenes · Google Drive como base de datos de imágenes

Drive no es una base de datos, pero tiene lo necesario para hacer de una:
**carpetas** (las "tablas"), **archivos** (las "filas"), **propiedades privadas de la app**
(`appProperties`, las "columnas") y un lenguaje de consulta (`q`, el "SQL").
Las consultas exactas están en [`03_consultas.md`](./03_consultas.md).

## 1. Carpetas

```
GolDorado - Imagenes/        raíz · appProperties { app:'goldorado', tipo:'raiz' }
├── equipo/                  appProperties { app:'goldorado', tipo:'carpeta', entidad:'equipo' }
├── jugador/
├── estadio/
├── torneo/
├── promocion/
└── usuario/                 fotos de perfil
```

- La raíz se crea **por la API** (`npm run db:setup`, o la primera subida). Con el scope
  `drive.file` la app solo ve lo que ella misma creó: una carpeta hecha a mano en la web
  de Drive le da 404/403. El setup imprime su id para `DRIVE_CARPETA_RAIZ_ID`; si esa
  variable está vacía, el servicio busca la raíz por sus `appProperties`.
- Las subcarpetas se crean al subir la primera imagen de esa entidad y su id queda en
  caché (memoria). Solo sirven para que un humano navegue Drive con orden: **el servicio
  nunca busca "por carpeta"**, busca por `appProperties`.
- En modo `cuenta_servicio` la raíz vive dentro de la **unidad compartida**
  (`parents: [DRIVE_UNIDAD_COMPARTIDA_ID]`).

## 2. Esquema de un archivo (la "fila")

| Campo de Drive | Valor | Equivale a |
|---|---|---|
| `id` | lo genera Drive (`1AbC...`) | PK; es el `Imagen.id` del contrato |
| `name` | nombre original saneado (`escudo-mil.svg`) | `Imagen.nombre` |
| `mimeType` | `image/png` · `image/jpeg` · `image/webp` · `image/svg+xml` | `Imagen.tipo_mime` |
| `size` | bytes (Drive lo calcula) | `Imagen.tamano_bytes` |
| `createdTime` | ISO 8601 UTC | `Imagen.creado_en`; la **vigente** es la más reciente |
| `description` | texto libre ("Escudo de Millonarios (MIL)") | `Imagen.descripcion` |
| `parents` | `[id de la subcarpeta]` | — |
| `trashed` | `false` mientras existe | borrado lógico |
| `appProperties.app` | `'goldorado'` | marca: "esta fila es nuestra" |
| `appProperties.entidad` | `equipo` · `jugador` · `estadio` · `torneo` · `promocion` · `usuario` | FK lógica (tipo) |
| `appProperties.idEntidad` | `'5'` (texto) | FK lógica al id en MySQL / SQL Server |
| `appProperties.subidoPor` | `'12'` (`'0'` = el setup) | auditoría |

### Límites de `appProperties` (y por qué alcanzan)

- **124 bytes por propiedad, contando clave + valor en UTF-8.** `idEntidad` (9 bytes de
  clave) deja 115 para el valor; el servicio rechaza ids de más de 100 bytes
  (`El id de la entidad es demasiado largo`).
- 30 propiedades privadas por app y por archivo (usamos 4), 100 en total.
- Son **privadas de la app que las escribió** (del cliente OAuth / proyecto): con otra
  credencial los archivos dejan de encontrarse. No cambiar de proyecto de Google Cloud
  sin migrar.

### Referencias entre bases

`entidad + idEntidad` apunta a una fila de otra base (equipo/jugador/estadio/torneo en
MySQL, promoción en PostgreSQL, usuario en SQL Server). No puede haber llave foránea
entre motores distintos (CONVENCIONES §4): si se borra un equipo, su escudo queda
huérfano hasta que alguien lo elimine.

## 3. Índice en memoria

`BuscarImagenes` es la consulta más frecuente de la plataforma (la home pide los escudos
de todos los partidos en cada carga). Consultar Drive cada vez costaría ~200 ms y 100
unidades de cuota por `files.list`. Por eso:

1. Al arrancar, el servicio lista **todas** las imágenes de la app (consulta 1 de
   `03_consultas.md`, paginada con `nextPageToken`) y arma
   `(entidad, idEntidad) → [imágenes, la más reciente primero]` + `id → imagen`.
2. Lo **reconstruye cada 5 minutos** (`DRIVE_INDICE_REFRESCO_MS`) para recoger cambios
   hechos por fuera (alguien borró un archivo en la web).
3. Lo **actualiza en el acto** en cada subida y borrado (sin esperar al refresco: el
   índice de búsqueda de Drive tarda unos segundos en ver un archivo nuevo). Si una
   subida ocurre durante una reconstrucción, el cambio se reaplica sobre el índice nuevo.
4. `BuscarImagenes` responde **solo desde el índice**; nunca llama a Drive.
5. `ObtenerImagen` sí descarga (`alt=media`, 200 unidades), pero con una **caché LRU de
   ~20 MB** de bytes delante; el BFF además sirve con `Cache-Control: immutable`.

El modo local usa el mismo índice, persistido en `storage/indice.json` (escritura
atómica: archivo temporal + `rename`).

## 4. Borrado: papelera, no `files.delete`

`EliminarImagen` y `reemplazar=true` mandan el archivo a la **papelera**
(`files.update { trashed: true }`):

- En una unidad compartida el borrado definitivo exige rol **Administrador**; la papelera
  basta con **Administrador de contenido**, el rol mínimo recomendado.
- Un borrado por error se recupera 30 días desde la web; luego Drive vacía la papelera.
- Todas las consultas llevan `trashed = false`: para el servicio la imagen deja de
  existir en el acto (y `ObtenerImagen` de ese id da `NOT_FOUND`).

## 5. Las dos formas de autenticarse

| | `oauth` (opción A) | `cuenta_servicio` (opción B) |
|---|---|---|
| Para quién | estudiante con **@gmail.com** | **Google Workspace** |
| Credencial | `DRIVE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | llave JSON (`GOOGLE_DRIVE_CREDENCIALES`) |
| Scope | `drive.file` (solo lo que la app crea; no sensible) | `drive` |
| Dónde viven los archivos | "Mi unidad" del usuario | **unidad compartida** (`DRIVE_UNIDAD_COMPARTIDA_ID`) |
| `files.list` | `corpora: 'user'` | `corpora: 'drive'`, `driveId`, `includeItemsFromAllDrives` |
| Cómo se vence | app en *Testing*: 7 días · 6 meses sin uso · revocación | llave revocada |

**Advertencia de cuota (2025):** las cuentas de servicio **no tienen cuota de
almacenamiento** y no pueden ser dueñas de archivos. Subir a una carpeta normal falla con
`403 storageQuotaExceeded` ("Service Accounts do not have storage quota"). Por eso el
servicio no arranca en `cuenta_servicio` sin `DRIVE_UNIDAD_COMPARTIDA_ID`, y si aun así
aparece ese error lo traduce a `UNAVAILABLE` con la pista en el log.

## 6. Errores de Drive → gRPC

| Drive | gRPC | Pista en el log |
|---|---|---|
| 404 | `NOT_FOUND` "Imagen no encontrada" | — |
| 401, `invalid_grant`, `invalid_client` | `UNAVAILABLE` | volver a correr `db/obtener-refresh-token.js` / revisar la llave |
| 403 `storageQuotaExceeded` | `UNAVAILABLE` | unidad compartida u OAuth |
| 403 de permisos | `UNAVAILABLE` | `drive.file` solo ve lo creado por la app / miembro de la unidad |
| 429, 403 `rateLimitExceeded` | se **reintenta** (backoff 2ⁿ s + azar, máx. 32 s, 5 veces); luego `UNAVAILABLE` | — |
| 5xx, red, DNS, timeout | `UNAVAILABLE` | conexión / proxy |

## 7. Datos semilla

`npm run db:setup` crea la raíz y las 6 subcarpetas y sube los **16 escudos SVG** de los
equipos semilla (`db/equipos.js`: ids 1..16, colores y `crest_seed` de
`server/db/02_datos.sql` del monolito), generados por `db/escudo.js` con el mismo diseño
que el escudo CSS (`TeamCrest.jsx`). Cada uno va con `reemplazar=true`: correrlo de nuevo
deja siempre **un** escudo vigente por equipo. Termina con una verificación (16/16).
