# ms-imagenes · Consultas a Google Drive (`q`)

El "SQL" de este servicio. Todas salen de `src/almacenes/consultasDrive.js`; aquí cada una
con su equivalente en Node (`@googleapis/drive`) y en REST (`curl`), para probarlas a mano.

## Reglas de la sintaxis `q`

- Propiedad privada de la app: `appProperties has { key='entidad' and value='equipo' }`
  (pública sería `properties has {...}`).
- Dentro de las comillas simples: `'` se escribe `\'` y `\` se escribe `\\`. **Todo valor
  que viene de afuera pasa por `escaparQ()`**; sin eso, un `idEntidad` como
  `7' or name contains '` cambiaría la consulta (inyección, igual que en SQL).
- `'<id>' in parents` mira solo el padre **directo**.
- Sin `orderBy` el orden es arbitrario. Se usa `modifiedTime desc` (la doc desaconseja
  `createdTime` en colecciones grandes); la "vigente" se decide luego por `createdTime`.
- `pageSize` máximo 1000 (en unidades compartidas, en la práctica 100): siempre paginar
  con `nextPageToken`.
- `appProperties` solo se leen con un token OAuth (nunca con una API key).

### Preparación común

```js
import { auth, drive as driveApi } from '@googleapis/drive';
const oauth = new auth.OAuth2({ clientId: process.env.DRIVE_OAUTH_CLIENT_ID, clientSecret: process.env.DRIVE_OAUTH_CLIENT_SECRET });
oauth.setCredentials({ refresh_token: process.env.DRIVE_OAUTH_REFRESH_TOKEN });
const drive = driveApi({ version: 'v3', auth: oauth });

const CAMPOS = 'nextPageToken, files(id,name,mimeType,size,createdTime,modifiedTime,description,appProperties,parents,trashed)';
// Unidad compartida (cuenta_servicio): agregar a cada files.list
const UNIDAD = { corpora: 'drive', driveId: process.env.DRIVE_UNIDAD_COMPARTIDA_ID, includeItemsFromAllDrives: true, supportsAllDrives: true };
```

```bash
# Un access token para curl (dura 1 hora): con el refresh token
TOKEN=$(curl -s https://oauth2.googleapis.com/token \
  -d client_id=$DRIVE_OAUTH_CLIENT_ID -d client_secret=$DRIVE_OAUTH_CLIENT_SECRET \
  -d refresh_token=$DRIVE_OAUTH_REFRESH_TOKEN -d grant_type=refresh_token | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")
```

---

## 1. Todas las imágenes de la app (construye el índice)

```text
appProperties has { key='app' and value='goldorado' } and mimeType != 'application/vnd.google-apps.folder' and trashed = false
```

```js
let pageToken; const archivos = [];
do {
  const { data } = await drive.files.list({
    q: "appProperties has { key='app' and value='goldorado' } and mimeType != 'application/vnd.google-apps.folder' and trashed = false",
    fields: CAMPOS, pageSize: 1000, orderBy: 'modifiedTime desc', pageToken, supportsAllDrives: true,
  });
  archivos.push(...data.files); pageToken = data.nextPageToken;
} while (pageToken);
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='app' and value='goldorado' } and mimeType != 'application/vnd.google-apps.folder' and trashed = false" \
  --data-urlencode "fields=nextPageToken, files(id,name,mimeType,size,createdTime,appProperties)" \
  --data-urlencode "orderBy=modifiedTime desc" -d pageSize=1000
```

## 2. Por entidad: los escudos de todos los equipos

```text
appProperties has { key='app' and value='goldorado' } and appProperties has { key='entidad' and value='equipo' } and mimeType != 'application/vnd.google-apps.folder' and trashed = false
```

```js
const { data } = await drive.files.list({ q: consultas.imagenesDeEntidad('equipo'), fields: CAMPOS, orderBy: 'modifiedTime desc', pageSize: 1000 });
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='app' and value='goldorado' } and appProperties has { key='entidad' and value='equipo' } and trashed = false" \
  --data-urlencode "fields=files(id,name,appProperties,createdTime)"
```

## 3. Por entidad + id: la foto de perfil del usuario 7 (la usa `reemplazar`)

```text
appProperties has { key='app' and value='goldorado' } and appProperties has { key='entidad' and value='usuario' } and appProperties has { key='idEntidad' and value='7' } and mimeType != 'application/vnd.google-apps.folder' and trashed = false
```

```js
import { consultas } from '../src/almacenes/consultasDrive.js';
const q = consultas.imagenesDe('usuario', idEntidad); // idEntidad ESCAPADO dentro
const { data } = await drive.files.list({ q, fields: CAMPOS, orderBy: 'modifiedTime desc' });
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='entidad' and value='usuario' } and appProperties has { key='idEntidad' and value='7' } and trashed = false" \
  --data-urlencode "fields=files(id,name,createdTime)"
```

Con un valor que trae comilla (`O'Brien`), el valor dentro de `q` es `'O\'Brien'`.

## 4. La más reciente primero (la "vigente")

Drive no tiene `LIMIT 1 ... ORDER BY created DESC` por grupo; se pide ordenado y se toma la
primera:

```js
const { data } = await drive.files.list({ q: consultas.imagenesDe('equipo', '5'), orderBy: 'createdTime desc', pageSize: 1, fields: 'files(id,name,createdTime)' });
const vigente = data.files[0];
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='entidad' and value='equipo' } and appProperties has { key='idEntidad' and value='5' } and trashed = false" \
  --data-urlencode "orderBy=createdTime desc" -d pageSize=1 --data-urlencode "fields=files(id,name,createdTime)"
```

## 5. Por tipo: todos los SVG (los escudos generados)

```text
appProperties has { key='app' and value='goldorado' } and mimeType = 'image/svg+xml' and trashed = false
```

```js
const { data } = await drive.files.list({ q: "appProperties has { key='app' and value='goldorado' } and mimeType = 'image/svg+xml' and trashed = false", fields: CAMPOS });
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='app' and value='goldorado' } and mimeType = 'image/svg+xml' and trashed = false" \
  --data-urlencode "fields=files(id,name,size)"
```

## 6. La papelera: lo que borró `EliminarImagen` / `reemplazar` (recuperable 30 días)

```text
appProperties has { key='app' and value='goldorado' } and trashed = true
```

```js
const { data } = await drive.files.list({ q: "appProperties has { key='app' and value='goldorado' } and trashed = true", fields: CAMPOS });
// Restaurar una: files.update({ fileId, requestBody: { trashed: false } })
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='app' and value='goldorado' } and trashed = true" \
  --data-urlencode "fields=files(id,name,appProperties,modifiedTime)"
# Restaurar
curl -s -X PATCH "https://www.googleapis.com/drive/v3/files/$ID?supportsAllDrives=true" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"trashed":false}'
```

## 7. Carpetas: la raíz y la subcarpeta de una entidad

```text
appProperties has { key='app' and value='goldorado' } and appProperties has { key='tipo' and value='raiz' } and mimeType = 'application/vnd.google-apps.folder' and trashed = false

'<RAIZ_ID>' in parents and appProperties has { key='app' and value='goldorado' } and appProperties has { key='tipo' and value='carpeta' } and appProperties has { key='entidad' and value='equipo' } and mimeType = 'application/vnd.google-apps.folder' and trashed = false
```

```js
const raiz = (await drive.files.list({ q: consultas.raiz(), fields: 'files(id,name)' })).data.files[0];
const equipo = (await drive.files.list({ q: consultas.subcarpeta(raiz.id, 'equipo'), fields: 'files(id)' })).data.files[0];
```

```bash
curl -s -G https://www.googleapis.com/drive/v3/files -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "q=appProperties has { key='app' and value='goldorado' } and appProperties has { key='tipo' and value='raiz' } and mimeType = 'application/vnd.google-apps.folder' and trashed = false" \
  --data-urlencode "fields=files(id,name)"
```

## 8. Lo que NO es una consulta `q`

| Operación | Node | REST | Cuota |
|---|---|---|---|
| Metadatos de un id | `files.get({ fileId, fields })` | `GET /drive/v3/files/{id}?fields=...` | 5 |
| Bytes de un id | `files.get({ fileId, alt: 'media' }, { responseType: 'stream' })` | `GET /drive/v3/files/{id}?alt=media` | **200** |
| Subir | `files.create({ requestBody, media, fields })` | `POST /upload/drive/v3/files?uploadType=multipart` | 50 |
| A la papelera | `files.update({ fileId, requestBody: { trashed: true } })` | `PATCH /drive/v3/files/{id}` `{"trashed":true}` | 50 |
| Salud | `files.get({ fileId: RAIZ_ID, fields: 'id' })` | `GET /drive/v3/files/{RAIZ_ID}?fields=id` | 5 |

```bash
curl -s "https://www.googleapis.com/drive/v3/files/$ID?alt=media&supportsAllDrives=true" -H "Authorization: Bearer $TOKEN" -o imagen.bin
```

## 9. Cómo responde `BuscarImagenes` sin consultar Drive

`BuscarImagenes({ entidad: 'equipo', idsEntidad: ['1','5','9'] })` **no ejecuta ninguna
consulta**: el índice en memoria se construyó con la consulta 1 al arrancar (y se rehace
cada 5 minutos), y por cada id pedido devuelve la primera de su lista (la de `createdTime`
más reciente). Es el equivalente a:

```sql
-- Lo que haría una base relacional; aquí lo resuelve un Map en memoria
SELECT DISTINCT ON (id_entidad) *
FROM imagen
WHERE entidad = 'equipo' AND id_entidad IN ('1','5','9') AND NOT trashed
ORDER BY id_entidad, creado_en DESC;
```

- `idsEntidad` vacío = la vigente de **cada** id de esa entidad.
- Un id sin imagen simplemente no aparece (el BFF cae al escudo CSS).
- Las consultas 3 (antes de `reemplazar`) y `files.get` (un id que no está en el índice)
  son las únicas que el servicio hace "en caliente".
