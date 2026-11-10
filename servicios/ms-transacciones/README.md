# ms-transacciones · MongoDB · gRPC 50054

Dueño de la información **transaccional y de seguridad** de GolDorado:

| Colección | Antes (monolito, SQL Server) | Qué guarda |
|---|---|---|
| `transacciones` | `Transaccion` + `Log_Transaccion` | Libro de movimientos de dinero (DEPOSITO, RETIRO, APUESTA, PREMIO, REEMBOLSO) con su `historial` de estados **embebido** |
| `logs_sesion` | `Log_Sesion` | Cada intento de acceso, exitoso o no (LOCAL, GOOGLE, MICROSOFT) |
| `eventos_seguridad` | — | Registro, cambio de clave, vinculación de Google/Microsoft, firma de webhook inválida... |

Nadie más escribe en Mongo: `ms-autenticacion`, `ms-apuestas` (outbox), `ms-pagos` y el BFF
le hablan por gRPC. Este servicio **no llama a nadie**.

## RPCs (`proto/transacciones.proto`)

| RPC | Qué hace | Errores |
|---|---|---|
| `RegistrarTransaccion` | **Idempotente por `codigo`**: inserta con upsert + `$setOnInsert` (nace con su primera entrada de historial). Si ya existía: mismo estado → la devuelve tal cual; otro estado → `$push` al historial; trae `referenciaExterna`/`proveedor`/`metodo` que faltaban → los completa | INVALID_ARGUMENT (código, tipo, estado, monto ≤ 0); FAILED_PRECONDITION si el código ya existe con **otro** usuario, tipo o monto |
| `ActualizarEstadoTransaccion` | Cambia el estado y agrega la entrada al historial en una sola operación atómica (no-op si es el mismo estado) | NOT_FOUND "Transacción no encontrada" |
| `ListarTransacciones` | Por usuario, más recientes primero, filtro opcional por tipo (20 por defecto, máx. 100) | INVALID_ARGUMENT |
| `ObtenerTransaccion` | Por código | NOT_FOUND |
| `RegistrarIntentoSesion` | Guarda el intento; `idUsuario` null si el correo no existe | INVALID_ARGUMENT si `exitoso=false` sin `motivoFallo` |
| `ContarIntentosFallidos` | Fallidos con ese correo en los últimos N minutos (15 por defecto) | INVALID_ARGUMENT |
| `RegistrarEventoSeguridad` | `detalle` (texto JSON) se guarda como objeto; si no es JSON válido, como `{ texto }` | INVALID_ARGUMENT |
| `ListarEventosSeguridad` | Por usuario y/o tipo, más recientes primero (50 por defecto) | — |
| `Salud` | `ping` a Mongo; `modo` dice si los validadores e índices ya se verificaron | nunca lanza |

Con Mongo caído, el proceso sigue arriba: `Salud` responde `estado: 'error'` y los demás RPC
fallan en ~2 s con UNAVAILABLE. Un intento de fondo reconecta solo (5 s, 10 s, ... hasta 60 s)
y, al lograrlo, asegura colecciones, validadores e índices **sin borrar datos**.

## Correrlo

```bash
cp .env.example .env      # valores de desarrollo local
npm run db:setup          # colecciones + validadores + índices + semilla (BORRA y recrea)
npm run dev               # o npm start
npm test                  # sin base ni red
```

## MongoDB: tres formas de tenerlo

1. **docker compose** (raíz del monorepo): `docker compose up -d mongo` → `mongodb://localhost:27017`,
   sin usuario (imagen `mongo:8`, contenedor `goldorado-mongo`).
2. **Instalación local**: MongoDB Community Server 8 (en Windows queda como servicio "MongoDB")
   → `mongodb://localhost:27017`. `mongosh` es opcional: `db:setup` usa el driver de Node.
3. **Atlas M0 (gratis)**: crear un cluster M0 → *Database Access*: un usuario (con `readWrite`
   basta para operar; para que el servicio actualice validadores con `collMod` y para
   `db:setup`, usar uno con `dbAdmin` o `atlasAdmin`) → *Network Access*: agregar tu IP →
   copiar la cadena `mongodb+srv://...` en `MONGO_URI`. Si el usuario no tiene `collMod`, el
   servicio solo avisa en el log y sigue.

## Diseño de la base

- **Validadores `$jsonSchema`** (`validationLevel: strict`, `validationAction: error`) que
  reemplazan las CHECK: tipos y estados válidos, `monto` Decimal128 > 0, historial con al menos
  una entrada, y en `logs_sesion` un intento fallido **siempre** con `motivoFallo`
  (`CHK_LogSesion_Motivo`, con `anyOf`). Una violación es el código 121; un código repetido, 11000.
- **`historial` embebido**: se lee siempre junto con la transacción, crece poco (2 o 3 cambios)
  y así el cambio de estado y su rastro se escriben en **una** operación atómica. El filtro
  exige el estado leído (control optimista), así `estadoAnterior` nunca miente.
- **Tipos como en el monolito**: `idUsuario` long (BIGINT), `monto` Decimal128 (DECIMAL(18,2)),
  fechas `Date`. En el contrato: number y ISO 8601 UTC.
- **`idUsuario` null a propósito** en `logs_sesion`: un correo inexistente no tiene usuario, y
  esa traza es justo la que delata la fuerza bruta.
- **Índices con nombre**: `UQ_Transacciones_Codigo` (la idempotencia), `IX_Transacciones_Usuario_Fecha`,
  `IX_Transacciones_Tipo_Estado_Fecha`, `IX_LogsSesion_Email_Fecha`, `IX_LogsSesion_Usuario_Fecha`,
  `IX_LogsSesion_Fecha_TTL` (TTL = `LOGS_SESION_DIAS` × 86400 s; Mongo borra solo lo viejo),
  `IX_EventosSeguridad_Usuario_Fecha`, `IX_EventosSeguridad_Tipo_Fecha`.
- Validadores e índices se definen **una vez** en `src/esquema.js` (arranque y `db:setup`).

## Dónde están las consultas

| Archivo | Para qué |
|---|---|
| `db/01_colecciones.js` | mongosh: borra y crea las colecciones con validadores e índices (copia legible de `src/esquema.js`) |
| `db/02_datos.js` | mongosh: semilla de CONVENCIONES §5 con `NumberLong` / `NumberDecimal` / `ISODate` |
| `db/03_consultas.js` | mongosh: consultas de sustentación — find/proyección/orden, `$unwind` del historial, extracto con sumas Decimal128 y saldo con `$cond`, depósitos por día con `$dateTrunc`, fuerza bruta con `$addToSet`/`$size`, `$lookup`, `$push`, violaciones 121 y 11000, `explain('executionStats')`, TTL |
| `db/setup.js` + `db/semilla.js` | lo mismo que 01 + 02 con el driver (`npm run db:setup`), con verificación de mínimo 2 documentos por colección |

```bash
mongosh "mongodb://localhost:27017" db/01_colecciones.js
mongosh "mongodb://localhost:27017" db/02_datos.js
mongosh "mongodb://localhost:27017" db/03_consultas.js
```

Las fechas de la semilla son **relativas** al día en que se corre (mismas horas de Bogotá que el
monolito, 1 a 5 días atrás): con fechas fijas el TTL terminaría borrando los logs de la demo.
El saldo con signo del libro cuadra con `cuenta_saldo` de ms-apuestas (250.000 y 84.500).

## Estructura

```
src/index.js               env -> gRPC -> Mongo en segundo plano -> apagado ordenado
src/config/env.js | db.js  variables | UN MongoClient (pool) por proceso + reintentos
src/esquema.js             validadores, índices, asegurarEsquema / recrearEsquema
src/grpc/handlers.js       traduce request <-> servicios (sin lógica)
src/servicios/             reglas: idempotencia, historial, validaciones (lanzan ErrorNegocio)
src/repositorios/          TODA la consulta a Mongo, con filtros tipados
src/utils/                 normalización de entrada y documento <-> mensaje
test/                      node --test, con colecciones y bases falsas en memoria
```
