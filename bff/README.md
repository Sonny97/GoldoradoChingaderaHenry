# bff — Backend For Frontend de GolDorado

API REST (Express 4) que es **el único punto de entrada del navegador**. Expone `/api/*`
con las mismas rutas y formas JSON del monolito (contrato completo en
[`docs/API-REST.md`](../docs/API-REST.md)) y por detrás habla gRPC con los seis
microservicios.

```
web ──REST──> bff ──gRPC──> ms-autenticacion (SQL Server)   perfil, sesiones, OAuth
                  ├──gRPC──> ms-deportes      (MySQL)        partidos, equipos, torneos
                  ├──gRPC──> ms-apuestas      (PostgreSQL)   cuotas, apuestas, saldo, promociones
                  ├──gRPC──> ms-transacciones (MongoDB)      libro de movimientos
                  ├──gRPC──> ms-pagos         (Firestore)    Wompi (PSE y Web Checkout)
                  └──gRPC──> ms-imagenes      (Drive)        escudos, fotos de perfil, banners
Wompi ──webhook──> bff ──gRPC──> ms-pagos
```

## Qué hace el BFF (y qué no)

- **No tiene base de datos ni reglas de negocio.** Traduce HTTP ↔ gRPC y junta respuestas.
- **Valida cada token con `ms-autenticacion.ValidarToken`** (no conoce `JWT_SECRET`): un
  token revocado con "cerrar sesión" deja de servir en el acto.
- **Agrega datos de varios servicios**: un `Match` es partido (MySQL) + cuotas (PostgreSQL)
  + escudos (Drive); un `User` es perfil (SQL Server) + saldo (PostgreSQL) + foto (Drive).
- **Degrada con elegancia**: los datos secundarios se piden con `Promise.allSettled`; si
  ms-apuestas o ms-imagenes no responden, la respuesta sale sin cuotas/escudos/saldo
  (`odds: []`, `crestUrl: null`, `balance: null`). Si cae el servicio *principal* de la
  ruta, 503 con el nombre del servicio.
- **Traduce errores gRPC → HTTP** con la tabla de API-REST (INVALID_ARGUMENT 400,
  UNAUTHENTICATED 401, NOT_FOUND 404, ALREADY_EXISTS 409, UNAVAILABLE 503...). El
  `message` es el `details` del servicio y `data` lo que venga en el metadato `x-datos`
  (`{ tokenDead: true }`, `{ campos: {...} }`).
- **Pone la IP y el navegador** (`contexto`) en las llamadas de sesión, y un
  `x-id-solicitud` por petición que viaja a todos los servicios (correlación de logs).
- **Imágenes por streaming**: `GET /api/imagenes/:id` pasa los trozos del stream gRPC a la
  respuesta HTTP respetando backpressure, con cabeceras de seguridad (nosniff + CSP sandbox).
- **OAuth (Google/Microsoft) con PKCE**: genera `state`, `nonce` y `code_verifier`, los
  guarda en una cookie firmada httpOnly de 10 min y entrega el JWT en el fragmento
  (`#token=`) de `${WEB_URL}/auth/callback`.
- **Webhook de Wompi** con el cuerpo crudo (para que el checksum cuadre) y respuesta
  exactamente `200 { success: true }`.

## Estructura

```
src/
  index.js            arranque: entorno, clientes gRPC, puerto, apagado ordenado
  app.js              crearApp({ env, clientes, log })  (clientes inyectados: las pruebas usan falsos)
  clientes.js         los 6 clientes gRPC y sus plazos (5 s; pagos 25 s; subida 15 s)
  config/env.js       variables de entorno validadas
  middleware/         autenticar (+ opcional, rol, perfil completo), idSolicitud, limites,
                      errores, noEncontrado
  agregadores/        armado de User, hidratación de Match, búsqueda de imágenes
  mapeadores/         proto -> REST, campo por campo (User, Team, League, Odd, Match,
                      Promo, Bet, Payment, Movement, Image)
  rutas/              salud, auth, oauth, catalogos, encuentros (+ calendario),
                      promociones, apuestas, billetera, pagos (+ webhook), imagenes
  utils/              apiResult, asyncHandler, grpcHttp, contexto, subida (multer)
scripts/verificar.js  verificación de punta a punta contra el sistema REAL, solo por REST
test/                 e2e contra servidores gRPC falsos + arranque sin servicios
```

## Uso

```bash
cp .env.example .env        # opcional en desarrollo: todo tiene valor por defecto
npm run dev                 # nodemon (recarga con cambios en src, proto y paquetes/comun)
npm start                   # node src/index.js
npm test                    # node --test: e2e con falsos + arranque (no necesita bases)
npm run verificar           # contra el sistema completo corriendo (BFF_URL=http://localhost:3000)
```

El BFF **arranca aunque ningún microservicio esté arriba**: `GET /api/salud` responde 503 y
lista cuál está `caido`, y cada ruta que dependa de uno caído responde 503.

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | puerto HTTP |
| `CORS_ORIGIN` | `http://localhost:3003` | orígenes permitidos (coma; `*` = todos) |
| `WEB_URL` | `http://localhost:3003` | frontend: destino de OAuth y `url_retorno` de Wompi |
| `URL_PUBLICA_API` | `http://localhost:3003` | base pública de `/api` (redirect_uri de OAuth) |
| `COOKIE_SECRETO` | aleatorio en desarrollo | firma la cookie `gd_oauth` (**obligatoria en producción**) |
| `TRUST_PROXY` | `loopback` | en quién confiar para `X-Forwarded-For` |
| `MS_*_URL` (6) | `localhost:50051..50056` | direcciones gRPC |
| `GRPC_TOKEN_INTERNO` | vacío | secreto compartido con los 6 servicios |
| `LOG_NIVEL` | `info` | `debug` muestra cada error gRPC traducido |

## Límites

- JSON de entrada: 100 KB (webhook: 256 KB crudo). Imágenes: 5 MB (`La imagen supera 5 MB`).
- Login, registro y `recuperar/solicitar`: 10 intentos / 15 min en producción (100 en
  desarrollo). Creación de pagos: 20 / 15 min.
