# ms-imagenes · Google Drive · gRPC :50056

Dueño de **todas las imágenes** de GolDorado: escudos de equipos, fotos de jugadores y
estadios, logos de torneos, banners de promociones y fotos de perfil. Contrato:
[`proto/imagenes.proto`](../../proto/imagenes.proto) (clave `'imagenes'`). No llama a
ningún otro servicio; lo consume el BFF (`GET /api/imagenes/:id`, escudos y avatares).

Drive hace de base de datos: carpetas por entidad, `appProperties` como columnas y
consultas `q` como SQL. Ver [`db/ESTRUCTURA.md`](db/ESTRUCTURA.md) y
[`db/03_consultas.md`](db/03_consultas.md).

## RPCs

| RPC | Qué hace | Fallos |
|---|---|---|
| `Salud` | `motor: 'Google Drive'`, `modo: 'local' \| 'drive/oauth' \| 'drive/cuenta_servicio'`. Drive: `files.get` de la carpeta raíz; local: la carpeta se puede escribir | nunca lanza |
| `SubirImagen` | valida y guarda; `reemplazar=true` borra las anteriores de esa entidad **después** de subir la nueva | `INVALID_ARGUMENT` |
| `ObtenerImagen` | **streaming de servidor**: 1.º `{ metadatos }`, luego `{ trozo }` de 64 KB (respeta la contrapresión y se detiene si el cliente cancela) | `NOT_FOUND` |
| `ObtenerMetadatos` | la `Imagen` de un id | `NOT_FOUND` |
| `BuscarImagenes` | la **vigente** (más reciente) de cada `idEntidad` pedido; lista vacía = todas las de esa entidad. Sale del índice en memoria, nunca de Drive | `INVALID_ARGUMENT` (entidad) |
| `EliminarImagen` | Drive: a la **papelera** (recuperable 30 días); local: borra el archivo | `NOT_FOUND` |

Errores de Drive: 404 → `NOT_FOUND`; credenciales, cuota (`storageQuotaExceeded`),
permisos, red y límites tras reintentos → `UNAVAILABLE`, con la **pista** de qué revisar
en el log.

### Validación de lo que se sube

- `entidad`: `equipo`, `jugador`, `estadio`, `torneo`, `promocion` o `usuario`;
  `idEntidad` no vacío (máx. 100 bytes: límite de `appProperties`).
- Tipos: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml` → si no,
  *"Solo se aceptan imágenes PNG, JPEG, WEBP o SVG"*.
- Tamaño ≤ `IMAGENES_MAX_BYTES` (5 MB) → *"La imagen supera 5 MB"*.
- **Números mágicos** coherentes con el tipo declarado (PNG `89 50 4E 47 0D 0A 1A 0A`,
  JPEG `FF D8 FF`, WEBP `RIFF....WEBP`, SVG = texto UTF-8 con `<svg`) → *"El contenido no
  corresponde a una imagen JPEG válida"*.
- SVG sin `<script>`, manejadores `on*=`, `javascript:`, `href`/`xlink:href` externos (solo
  `#fragmento`), `url(...)` externos, `<foreignObject>`, `DOCTYPE`/`ENTITY` →
  *"El SVG contiene código no permitido"*.

## Cómo correrlo

```powershell
cd servicios/ms-imagenes
copy .env.example .env          # por defecto IMAGENES_ALMACEN=local: no necesita Google
npm run db:setup                # carpetas + los 16 escudos SVG de los equipos semilla
npm run dev                     # o npm start
npm test                        # node --test (sin red)
```

### Con Google Drive

Guía completa: [`docs/GOOGLE-MICROSOFT-DRIVE.md` §4](../../docs/GOOGLE-MICROSOFT-DRIVE.md).

- **Opción A — @gmail.com (OAuth):** `DRIVE_AUTENTICACION=oauth`, cliente OAuth "Aplicación
  web" con la redirección `http://localhost:53682/oauth2callback`, scope `drive.file`, app
  **publicada**. Refresh token, una sola vez: `node db/obtener-refresh-token.js` (servidor
  local + PKCE).
- **Opción B — Workspace (cuenta de servicio):** `DRIVE_AUTENTICACION=cuenta_servicio`,
  llave en `credenciales/drive.json` y **`DRIVE_UNIDAD_COMPARTIDA_ID` obligatoria**: desde
  2025 las cuentas de servicio no tienen cuota propia (`storageQuotaExceeded`).

Después `npm run db:setup`, que crea la raíz "GolDorado - Imagenes" por la API e imprime
`DRIVE_CARPETA_RAIZ_ID=...` para el `.env`.

## Estructura

```
src/
├── index.js                 env -> almacén -> servidor gRPC -> índice (no bloqueante) -> apagado
├── config/env.js            variables (cargarEnv) + requisitos según el modo
├── config/requisitos.js     qué exige cada DRIVE_AUTENTICACION (función pura)
├── grpc/handlers.js         RPC <-> servicio (mapea Imagen campo por campo)
├── servicios/imagenServicio.js  validar, reemplazar, transmitir en trozos
├── almacenes/
│   ├── index.js             elige drive | local (misma interfaz)
│   ├── drive.js             Drive: carpetas, índice en memoria, caché LRU, papelera
│   ├── clienteDrive.js      OAuth2 (refresh token) o JWT (cuenta de servicio)
│   ├── consultasDrive.js    las consultas q, con escape
│   ├── erroresDrive.js      Drive -> NOT_FOUND / UNAVAILABLE + pistas
│   └── local.js             disco + indice.json atómico
└── utils/                   validación (números mágicos, SVG), trozos de 64 KB, LRU, índice, backoff
db/
├── setup.js                 npm run db:setup (re-ejecutable)
├── equipos.js · escudo.js · color.js   los 16 escudos SVG (diseño de TeamCrest.jsx)
├── obtener-refresh-token.js
├── ESTRUCTURA.md · 03_consultas.md
test/                        node --test: validación, escudos, almacén local, Drive falso, streaming gRPC real, arranque
```
