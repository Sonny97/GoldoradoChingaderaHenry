# Convenciones del proyecto — GolDorado (microservicios)

Este documento es la **fuente de verdad** para cualquiera que escriba código en el
monorepo. Si algo aquí contradice a otro archivo, gana este documento (y luego se
corrige el otro).

Proyecto de referencia (monolito original): `C:\developer\goldorado`. Su estilo es el
estilo de este proyecto: **código en español, comentarios que explican el porqué**,
validaciones en la aplicación como comodidad y **garantías en la base de datos**.

---

## 1. Mapa: qué base usa cada microservicio

Tomado del tablero de clase:

| Microservicio | Motor | Qué guarda (tablero) | Puerto gRPC |
|---|---|---|---|
| `ms-autenticacion` | **SQL Server** | *loguin*: usuario, contraseña y token de seguridad; cuentas de Google y Microsoft | 50051 |
| `ms-deportes` | **MySQL** | *Jugadores*: jugadores, equipos, estadios, calendarios (información gruesa) | 50052 |
| `ms-apuestas` | **PostgreSQL** (Azure, nube) | *API*: el núcleo del negocio — mercados, cuotas, apuestas, billetera, promociones | 50053 |
| `ms-transacciones` | **MongoDB** | información transaccional y de seguridad (libro de movimientos, logs de sesión, eventos de seguridad) | 50054 |
| `ms-pagos` | **Firebase (Firestore)** | pasarela de pago **Wompi** (PSE y Web Checkout) | 50055 |
| `ms-imagenes` | **Google Drive** | todas las imágenes | 50056 |
| `bff` | — (sin base) | API REST para el frontend; integra los 6 servicios por gRPC | HTTP 3000 |
| `web` | — | React + Vite, mismo diseño del monolito | HTTP 3003 |

Interpretación de "PostgreSQL — API (Azure)": PostgreSQL alojado en Azure (Azure Database
for PostgreSQL – Flexible Server) es la base del **API de apuestas**, es decir, el núcleo
transaccional del negocio que no es login, ni información deportiva, ni pagos, ni imágenes.
En local se usa un PostgreSQL normal; en Azure solo cambia el `.env` (`PG_SSL=true`).

## 2. Estructura del monorepo

```
goldorado-microservicios/
├── package.json            workspaces + scripts (npm run dev levanta todo)
├── proto/                  CONTRATOS gRPC (.proto) — compartidos por todos
├── paquetes/comun/         @goldorado/comun: env, logger, errores, servidor/cliente gRPC, salud
├── servicios/
│   ├── ms-autenticacion/   SQL Server
│   ├── ms-deportes/        MySQL
│   ├── ms-apuestas/        PostgreSQL
│   ├── ms-transacciones/   MongoDB
│   ├── ms-pagos/           Firestore + Wompi
│   └── ms-imagenes/        Google Drive
├── bff/                    Express: REST -> gRPC
├── web/                    React 19 + Vite 7 (copia del diseño del monolito)
├── docs/                   arquitectura, consultas, Wompi, OAuth, instalación
└── docker-compose.yml      SQL Server, MySQL, PostgreSQL y MongoDB locales
```

### Plantilla de un microservicio

```
servicios/ms-x/
├── package.json        "name": "@goldorado/ms-x", "type": "module"
├── .env.example        TODAS las variables, comentadas (el .env real no se versiona)
├── README.md           qué es dueño, RPCs, cómo correrlo, dónde están las consultas
├── src/
│   ├── index.js        arranque: env -> servidor gRPC -> conexión a la base (NO bloqueante) -> apagado ordenado
│   ├── config/env.js   cargarEnv(import.meta.url, {...})  (de @goldorado/comun)
│   ├── config/db.js    UNA conexión/pool para todo el proceso + cerrar()
│   ├── grpc/handlers.js  implementación de cada RPC: traduce request <-> servicios
│   ├── servicios/      reglas de negocio (lanzan ErrorNegocio)
│   ├── repositorios/   TODA la consulta a la base, siempre parametrizada
│   ├── clientes/       clientes gRPC hacia OTROS microservicios (si aplica)
│   └── utils/
├── db/                 esquema, datos semilla y CONSULTAS (ver §7)
│   └── setup.js        npm run db:setup
└── test/               node --test (sin base: lógica pura y handlers con repos falsos)
```

Reglas que vienen del monolito y se mantienen:

- **Rutas/handlers traducen, servicios deciden, repositorios consultan.** Ni un handler
  ni un servicio escriben una consulta.
- **Todo valor del usuario entra como parámetro**, nunca concatenado (`@p` en mssql,
  `?`/`:nombre` en mysql2, `$1` en pg, objetos de filtro en Mongo con valores tipados).
- **El servicio arranca aunque la base esté caída** y lo dice en el RPC `Salud`
  (el monolito hacía lo mismo con `/api/salud`). La conexión se intenta al arrancar para
  que el error salga en el segundo uno, pero no tumba el proceso.
- **Apagado ordenado** con `apagadoOrdenado()` (primero el servidor gRPC, luego la base).
- **Toda restricción nombrada** en SQL (`PK_`, `FK_`, `UQ_`, `CHK_`, `DF_`, `IX_`).

## 3. gRPC

- Contratos en `proto/*.proto`. **No se modifica un .proto sin actualizar a todos sus
  consumidores** (servicio dueño + BFF + servicios que lo llaman).
- Carga con `@grpc/proto-loader` en tiempo de ejecución (sin generar código), opciones
  únicas en `paquetes/comun/src/grpc/proto.js`:
  - `keepCase:false` → los campos llegan en **camelCase** (`id_usuario` → `idUsuario`).
  - `longs:Number` → `int64` llega como `number`.
  - `defaults:true` → strings vacíos llegan como `''`, mensajes no enviados como `null`.
  - **Campos `optional` no enviados quedan `undefined`** (y aparece una propiedad
    virtual `_campo`). Por eso el BFF **mapea campo por campo**: nunca hace
    `res.json(respuestaGrpc)` ni `{...respuestaGrpc}`.
  - Para NO enviar un `optional`, omitir la clave (o `undefined`). `null` también vale.
- Servidor: `crearServidorGrpc({ nombre, log, tokenInterno })` + `registrar(clave, impl)` +
  `iniciar(puerto)`. Los métodos de `impl` se llaman **igual que en el .proto
  (PascalCase)**, reciben `(request, ctx)` y devuelven la respuesta (o lanzan).
  Si falta un método, el servidor no arranca.
- Cliente: `crearClienteGrpc(clave, { direccion, tokenInterno, plazoMs })` → objeto con
  los métodos del .proto que devuelven promesas. **Siempre con plazo** (deadline).
- `Salud` en todos los servicios: `crearRpcSalud({ servicio, motor, baseDatos, modo, version, comprobar })`.
  Nunca lanza: responde `estado: 'error'` con el `detalle`.
- Token interno opcional: si `GRPC_TOKEN_INTERNO` tiene valor, cada servidor exige el
  metadato `x-token-interno` con ese valor y cada cliente lo envía. Mismo valor en los 7 procesos.
- Correlación: el BFF genera un `x-id-solicitud` por petición HTTP y lo propaga.

### Errores

Los errores **no viajan en la respuesta**: se lanzan con los ayudantes de `@goldorado/comun`
y llegan como estado gRPC con un mensaje en español **listo para mostrarle al usuario**.

| Ayudante | Código gRPC | HTTP en el BFF | Ejemplo |
|---|---|---|---|
| `invalido(msg)` | INVALID_ARGUMENT | 400 | "Ingresa un monto válido" |
| `precondicion(msg)` | FAILED_PRECONDITION | 400 (409 si el BFF lo decide) | "Saldo insuficiente" |
| `noAutenticado(msg)` | UNAUTHENTICATED | 401 | "Usuario o contraseña incorrectos" |
| `sinPermiso(msg)` | PERMISSION_DENIED | 403 | "No puedes ver ese pago" |
| `noEncontrado(msg)` | NOT_FOUND | 404 | "Partido no encontrado" |
| `yaExiste(msg)` | ALREADY_EXISTS | 409 | "Ya existe una cuenta con ese correo" |
| `demasiados(msg)` | RESOURCE_EXHAUSTED | 429 | "Demasiados intentos" |
| `noDisponible(msg)` | UNAVAILABLE | 503 | base o servicio caído |
| (excepción no controlada) | INTERNAL | 500 | "Ocurrió un error inesperado en ms-x" |

Datos extra de un error → tercer argumento: `precondicion('Demasiados intentos...', { tokenDead: true })`.
Viajan en el metadato de cierre `x-datos` (JSON) y el BFF los pone en `data` del sobre.

Los errores de base (UNIQUE, FK, CHECK, conexión) de los 4 drivers los traduce
`traducirErrorBaseDatos` (en `@goldorado/comun`). Un servicio puede capturarlos antes para
dar un mensaje más preciso (p. ej. "Ya existe una cuenta con ese documento").

### Tipos en los contratos

- Fechas: **string ISO 8601 UTC** (`aFechaHoraIso`), fechas sin hora `YYYY-MM-DD` (`aFechaIso`).
- Dinero: `double` en **pesos sin centavos**; en las bases `DECIMAL(18,2)` / `NUMERIC(18,2)` /
  `Decimal128`. Wompi trabaja en centavos: solo `ms-pagos` multiplica/divide por 100.
- Cuotas: `double` con 2 decimales (`2.00`).
- Roles: en minúscula en los contratos (`'cliente'`, `'admin'`), en MAYÚSCULA en la base.

## 4. Propiedad de los datos y referencias entre bases

**Base de datos por servicio**: nadie lee ni escribe la base de otro. Las referencias entre
bases son **ids sin llave foránea** (no puede haberla entre motores distintos):

| Columna / campo | Vive en | Apunta a |
|---|---|---|
| `cuenta_saldo.id_usuario`, `apuesta.id_usuario` | PostgreSQL | `Usuario.id_usuario` (SQL Server) |
| `cuota_oferta.id_encuentro` | PostgreSQL | `encuentro.id_encuentro` (MySQL) |
| `promocion_torneo.id_torneo` | PostgreSQL | `torneo.id_torneo` (MySQL) |
| `apuesta.id_transaccion` (UUID) | PostgreSQL | `transacciones.codigo` (MongoDB) |
| `transacciones.idUsuario`, `logs_sesion.idUsuario` | MongoDB | `Usuario.id_usuario` |
| `pagos/{ref}.idUsuario` | Firestore | `Usuario.id_usuario` |
| `appProperties.entidad + idEntidad` | Drive | equipo/jugador/promoción/usuario de su base |

Cómo se mantiene la consistencia sin transacciones distribuidas:

1. **Idempotencia por clave de negocio**: `AcreditarDeposito` por `referencia` (UNIQUE en
   `movimiento_saldo`), `RegistrarTransaccion` por `codigo` (índice único en Mongo).
   Un reintento nunca duplica dinero.
2. **Bandeja de salida (outbox)** en `ms-apuestas`: la apuesta, el descuento del saldo y el
   evento para Mongo se escriben en la MISMA transacción de PostgreSQL (`evento_salida`);
   un proceso de fondo los envía a `ms-transacciones` y los marca enviados
   (`FOR UPDATE SKIP LOCKED`).
3. **Creación perezosa**: la billetera se crea al registrarse (`AsegurarBilletera`), y si eso
   falló, se vuelve a asegurar antes de cualquier operación de dinero (`INSERT ... ON CONFLICT DO NOTHING`).
4. **Conciliación** en `ms-pagos`: cada minuto revisa pagos PENDIENTE viejos contra la API de
   Wompi y reintenta acreditaciones o registros en el libro que hayan fallado.
5. **Auditoría best-effort**: los logs de sesión y eventos de seguridad se envían a
   `ms-transacciones` con `llamadaOpcional()`: si Mongo está caído, el login igual funciona.

### Quién llama a quién (gRPC)

```
web ──REST──> bff ──gRPC──> ms-autenticacion ──gRPC──> ms-transacciones
                  ├──gRPC──> ms-deportes
                  ├──gRPC──> ms-apuestas ──gRPC──> ms-deportes (estado del partido)
                  │                      └──gRPC──> ms-transacciones (outbox)
                  ├──gRPC──> ms-transacciones
                  ├──gRPC──> ms-pagos ──gRPC──> ms-apuestas (acreditar)
                  │                   └──gRPC──> ms-transacciones (libro del depósito)
                  └──gRPC──> ms-imagenes
Wompi ──webhook HTTPS──> bff ──gRPC──> ms-pagos
```

## 5. Datos semilla COMPARTIDOS (ids fijos)

Como las referencias entre bases son por id, **los datos semilla fijan los ids
explícitamente** (en el monolito no hacía falta; aquí sí, y conviene explicarlo así en la
sustentación). Las fechas de partidos, jornadas, temporadas y promociones son
**relativas a la fecha en que se corre el seed** (`UTC_TIMESTAMP()`, `CURRENT_DATE`, ...)
para que la demo nunca muestre partidos "próximos" en el pasado ni promociones vencidas.

Regla del taller que se conserva: **mínimo 2 registros por tabla/colección** en cada base,
con su consulta de verificación al final del archivo de datos.

### Usuarios (SQL Server)

| id | correo | clave | rol | ficha de cliente |
|---|---|---|---|---|
| 1 | demo@goldorado.co | `Demo1234!` | CLIENTE | Camilo Rojas, CC 1012345678, nac. 1996-03-11, tel. 3001234567 (MOVIL) y 6012345678 (FIJO) |
| 2 | valentina.mesa@hotmail.com | `Vale2024*` | CLIENTE | Valentina Mesa, CC 1098765432, nac. 1999-07-24, tel. 3109876123 (MOVIL) |
| 3 | admin@goldorado.co | `Admin2026#` | ADMIN | — (no es Cliente) |
| 4 | andres.gomez.demo@gmail.com | — (sin clave local) | CLIENTE | — perfil INCOMPLETO; entró con GOOGLE |

Hashes bcrypt (los mismos del monolito, generados con `npm run db:hash`):
- `Demo1234!`  → `$2a$10$cKMr9v8ge6apRN1qNk3XcuWTff2wnpt7fBtR.liDnyI6qMlRjtf5e`
- `Vale2024*`  → `$2a$10$huWlTF4coHyn1Zp93N/t3ORFpMZRe7dM4XLKXmJny57lDew/wsdky`
- `Admin2026#` → `$2a$10$27R9WlZOuERi8uEqqCEPYeK5PySjkNLCHOZw4lBu50k5RcsNnXiSK`

Cuentas externas: usuario 4 ↔ GOOGLE (sub `100000000000000000004`), usuario 2 ↔ MICROSOFT
(sub `00000000-0000-0000-0000-000000000002`). Son de demostración: no inician sesión de verdad.

### Fútbol (MySQL) — mismos datos del monolito (`server/db/02_datos.sql`)

- `torneo`: 1 Liga BetPlay (COL, `#e7c566`), 2 Copa Libertadores (CONMEBOL, `#3b82f6`),
  3 Premier League (ENG, `#a78bfa`), 4 LaLiga (ESP, `#fb7185`).
- `equipo` 1..16 en este orden: MIL, NAL, AME, JUN, BOC, FLA, RIV, PAL, MCI, LIV, ARS, CHE,
  RMA, BAR, ATM, SEV (colores, ciudades, `crest_seed` y fundación del monolito).
- `jugador` 1..12: los 12 de Liga BetPlay del monolito, en el mismo orden.
- `encuentro` 1..12 = `m-01`..`m-12` del monolito, mismos equipos/estadios/árbitros/goles/
  minuto/destacado. Fechas relativas: 1–4 en vivo (kickoff = ahora − minuto), 5–8 próximos
  (+1, +2, +3, +4 días, misma hora del monolito), 9–12 finalizados (−3, −4, −5, −6 días).
- Jornada 1 de cada temporada = semana pasada (finalizados), jornada 2 = semana actual.

### Apuestas (PostgreSQL)

- `cuota_oferta`: 4 por encuentro (1, X, 2, GG) con los valores del monolito; `CERRADO`
  para los encuentros 9..12 (finalizados), `ABIERTO` para el resto. 48 filas.
- `cuenta_saldo`: usuario 1 → 250.000 disponible / 50.000 bloqueado; usuario 2 → 84.500 / 15.500.
- `apuesta`: usuario 1 → 50.000 a "Local" del encuentro 1 @ 2.00, PENDIENTE, transacción
  `b3a1c0de-0001-4a00-9000-000000000001`; usuario 2 → 15.500 a "Ambos" del encuentro 5
  @ 1.60, PENDIENTE, transacción `b3a1c0de-0002-4a00-9000-000000000002`.
- `movimiento_saldo`: depósito 300.000 (ref `GD-SEED-0001`) y apuesta −50.000 del usuario 1;
  depósito 100.000 (ref `GD-SEED-0002`) y apuesta −15.500 del usuario 2.
- `promocion`: las 6 del monolito, con `fecha_expira` = `CURRENT_DATE` + 30..120 días.
  `promocion_torneo`: "50% descuento" → 1,2,3,4; "Cuota mejorada" → 1,4; "Combinada segura" → 2.

### Transacciones y seguridad (MongoDB)

- `transacciones`: `GD-SEED-0001` (DEPOSITO 300.000, usuario 1, Wompi/NEQUI, COMPLETADO),
  `b3a1c0de-0001-...` (APUESTA 50.000, usuario 1), `GD-SEED-0002` (DEPOSITO 100.000,
  usuario 2, Wompi/PSE), `b3a1c0de-0002-...` (APUESTA 15.500, usuario 2). Cada una con su
  `historial` embebido.
- `logs_sesion`: los 3 del monolito (éxito de demo, fallo de Valentina, correo inexistente
  con `idUsuario` nulo) + el login con Google del usuario 4.
- `eventos_seguridad`: REGISTRO de 1 y 2, CUENTA_EXTERNA_VINCULADA del 4.

### Pagos (Firestore)

- `pagos/GD-SEED-0001`: usuario 1, 300.000, CHECKOUT/NEQUI, APROBADO, acreditado.
- `pagos/GD-SEED-0002`: usuario 2, 100.000, PSE ("Banco que aprueba"), APROBADO, acreditado.

### Imágenes (Drive)

- El setup crea la carpeta raíz y sube **16 escudos SVG** generados con los colores de cada
  equipo (`entidad = 'equipo'`, `idEntidad = '1'..'16'`). El frontend los muestra; si
  `ms-imagenes` está apagado, cae al escudo generado por CSS del monolito.

## 6. Variables de entorno

Nombres **idénticos** en todos los procesos:

| Variable | Quién | Ejemplo |
|---|---|---|
| `GRPC_PUERTO` | cada servicio | 50051 … 50056 |
| `GRPC_HOST` | cada servicio | `0.0.0.0` |
| `GRPC_TOKEN_INTERNO` | todos (opcional) | mismo secreto en los 7 |
| `MS_AUTENTICACION_URL` | quien lo llame | `localhost:50051` |
| `MS_DEPORTES_URL` | | `localhost:50052` |
| `MS_APUESTAS_URL` | | `localhost:50053` |
| `MS_TRANSACCIONES_URL` | | `localhost:50054` |
| `MS_PAGOS_URL` | | `localhost:50055` |
| `MS_IMAGENES_URL` | | `localhost:50056` |
| `LOG_NIVEL` | todos | `info` \| `debug` |
| `NODE_ENV` | todos | `development` |

Por servicio (ver cada `.env.example`):

- **ms-autenticacion**: `DB_SERVER`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE=GolDoradoAuth`,
  `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`, `JWT_SECRET`, `JWT_EXPIRES_IN=2h`,
  `OTP_CODIGO_DEV=482913`, `OTP_TTL_MIN=10`, `OTP_MAX_INTENTOS=5`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT=common`.
- **ms-deportes**: `MYSQL_HOST`, `MYSQL_PORT=3306`, `MYSQL_USER`, `MYSQL_PASSWORD`,
  `MYSQL_DATABASE=goldorado_deportes`, `MYSQL_SSL=false`.
- **ms-apuestas**: `PG_HOST`, `PG_PORT=5432`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE=goldorado_apuestas`,
  `PG_SSL=false` (Azure: `true`), `PG_SSL_VERIFICAR=false`, `OUTBOX_INTERVALO_MS=3000`.
- **ms-transacciones**: `MONGO_URI=mongodb://localhost:27017`, `MONGO_DB=goldorado_transacciones`,
  `LOGS_SESION_DIAS=180`.
- **ms-pagos**: `PAGOS_ALMACEN=firestore|memoria`, `FIREBASE_PROJECT_ID`, `FIREBASE_CREDENCIALES`
  (ruta al JSON de cuenta de servicio), `FIRESTORE_EMULATOR_HOST` (opcional),
  `WOMPI_MODO=sandbox|produccion|simulado`, `WOMPI_LLAVE_PUBLICA`, `WOMPI_LLAVE_PRIVADA`,
  `WOMPI_SECRETO_EVENTOS`, `WOMPI_SECRETO_INTEGRIDAD`, `PAGOS_MONTO_MINIMO`, `PAGOS_MONTO_MAXIMO`,
  `CONCILIACION_INTERVALO_MS=60000`.
- **ms-imagenes**: `IMAGENES_ALMACEN=drive|local`, `DRIVE_AUTENTICACION=cuenta_servicio|oauth`,
  `GOOGLE_DRIVE_CREDENCIALES`, `DRIVE_UNIDAD_COMPARTIDA_ID`, `DRIVE_OAUTH_CLIENT_ID`,
  `DRIVE_OAUTH_CLIENT_SECRET`, `DRIVE_OAUTH_REFRESH_TOKEN`, `DRIVE_CARPETA_RAIZ_ID`,
  `IMAGENES_DIR_LOCAL=./storage`, `IMAGENES_MAX_BYTES=5242880`.
- **bff**: `PORT=3000`, `CORS_ORIGIN=http://localhost:3003`, `WEB_URL=http://localhost:3003`,
  `URL_PUBLICA_API=http://localhost:3003` (base pública donde se ve `/api`, para callbacks de
  OAuth), `COOKIE_SECRETO`, los 6 `MS_*_URL`, `GRPC_TOKEN_INTERNO`, `TRUST_PROXY=loopback`.

Valores por defecto para desarrollo local (deben coincidir con `docker-compose.yml`; los
`.env.example` los usan como ejemplo):

| Base | Usuario | Clave (solo desarrollo) | Host:puerto (instalación local) | Host:puerto (docker compose) |
|---|---|---|---|---|
| SQL Server | `goldorado_app` (o `sa` en docker) | `GolDorado_Sa_2026!` (sa de docker) | `localhost:1433` (SQLEXPRESS del monolito) | `localhost:1434` |
| MySQL | `goldorado_app` | `GolDorado_App_2026!` | `localhost:3306` | `localhost:3306` |
| PostgreSQL | `goldorado_app` | `GolDorado_App_2026!` | `localhost:5432` | `localhost:5433` |
| MongoDB | — | — | `mongodb://localhost:27017` | `mongodb://localhost:27017` |

Modos de desarrollo sin nube (para poder correr todo en un portátil):
`PAGOS_ALMACEN=memoria`, `WOMPI_MODO=simulado`, `IMAGENES_ALMACEN=local`. Con ellos la app
funciona de punta a punta sin Firebase, sin llaves de Wompi y sin Drive; **los modos reales
son los del tablero** y la documentación explica cómo activarlos.

## 7. Dónde quedan las CONSULTAS de cada base

Cada servicio guarda en su carpeta `db/` el esquema, los datos y un archivo de
**consultas de sustentación** (como `03_consultas.sql` del monolito):

| Servicio | Archivos |
|---|---|
| ms-autenticacion | `db/01_esquema.sql`, `db/02_datos.sql`, `db/03_consultas.sql` (T-SQL) |
| ms-deportes | `db/01_esquema.sql`, `db/02_datos.sql`, `db/03_consultas.sql` (MySQL 8) |
| ms-apuestas | `db/01_esquema.sql`, `db/02_datos.sql`, `db/03_consultas.sql` (PostgreSQL) |
| ms-transacciones | `db/01_colecciones.js`, `db/02_datos.js`, `db/03_consultas.js` (mongosh) |
| ms-pagos | `db/ESTRUCTURA.md`, `db/firestore.rules`, `db/firestore.indexes.json`, `db/02_datos.js`, `db/03_consultas.js` (Admin SDK) |
| ms-imagenes | `db/ESTRUCTURA.md`, `db/03_consultas.md` (consultas `q` de la API de Drive), `db/setup.js` |

Índice general con enlaces: `docs/CONSULTAS.md`.

## 8. Estilo de código

- Node 20+ (probado con 24), **ESM** (`"type": "module"`), sin TypeScript, sin transpilar.
- Identificadores y comentarios en **español** (como el monolito). Los nombres de campos JSON
  del contrato REST hacia el frontend se conservan como estaban (inglés: `homeTeam`, `balance`…)
  porque el frontend ya los usa.
- Cada archivo empieza con un comentario que explica **para qué existe** y las decisiones no obvias.
- Pruebas con `node --test` (sin dependencias extra). Las que necesitan una base real se
  saltan solas si no hay conexión (`t.skip`).
- Nada de secretos en el repositorio: `.env` y `credenciales/` están en `.gitignore`;
  cada servicio trae su `.env.example` completo y comentado.
