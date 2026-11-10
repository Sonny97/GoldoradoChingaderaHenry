# ms-deportes

Microservicio de la **información deportiva** de GolDorado: países, regiones, ciudades,
estadios, torneos, temporadas, equipos y sus colores, jugadores, jornadas (calendario),
encuentros, alineaciones y estadísticas. Motor **MySQL 8** (base `goldorado_deportes`),
contrato `proto/deportes.proto`, puerto gRPC **50052**.

No sabe nada de cuotas ni de apuestas: eso es de `ms-apuestas`, que guarda el
`id_encuentro` como referencia **sin llave foránea** (no puede haberla entre motores). El
BFF une las dos cosas para armar la tarjeta del partido. Este servicio no llama a ningún otro.

## RPCs

| RPC | Qué hace | Fallos |
|---|---|---|
| `Salud` | `SELECT 1` contra MySQL; motor `MySQL`, base `MYSQL_DATABASE` | nunca falla: `estado: 'error'` + `detalle` |
| `ListarTorneos` | torneos con su temporada vigente (la última que empezó), `pais = COALESCE(pais, confederacion)` | |
| `ListarEquipos` | equipos (opcional `idTorneo`), cada uno con su torneo; colores en UNA consulta `IN (...)` | |
| `ObtenerEquipo` | un equipo con su torneo y colores | `NOT_FOUND` "Equipo no encontrado" |
| `ListarJugadores` | jugadores (opcional `idEquipo`) con el nombre del equipo | |
| `ListarEstadios` | estadios con ciudad y país | |
| `ListarEncuentros` | filtros `estado` (`''`/`all` = todos; uno inválido como `esports` = **lista vacía**), `idTorneo`, `idEquipo` (local o visitante), `limite`; orden de relevancia: live, upcoming, finished, canceled y luego kickoff | |
| `ListarDestacados` | `destacado DESC` y luego relevancia; `limite` 0 = 4 | |
| `ObtenerEncuentro` | un partido (lo usa `ms-apuestas` para validar su estado) | `NOT_FOUND` "Partido no encontrado" |
| `ObtenerDetalleEncuentro` | partido + estadística en pares local/visitante (ausente si no hay) + alineación con estadística individual | `NOT_FOUND` "Partido no encontrado" |
| `ObtenerEncuentrosPorIds` | hidrata el historial de apuestas; los ids que no existen no vienen | |
| `ListarCalendario` | jornadas con sus encuentros (opcional `idTorneo`, `numeroJornada`) | |

Un id que no es entero positivo responde `INVALID_ARGUMENT` "Identificador de partido
inválido" (el mismo mensaje de la ruta del monolito). Si MySQL está caído, los RPC de datos
responden `UNAVAILABLE` con un mensaje genérico: el texto del driver nunca llega al cliente.

Reglas del contrato que vienen del monolito:

- **`goles` NULL ⇒ `golesLocal`/`golesVisitante` AUSENTES**, nunca 0: un partido que no ha
  empezado no va 0-0. `minuto` solo viaja si el partido está en vivo.
- Colores por defecto `#101b36` / `#f4f6fb` cuando un equipo no tiene.
- La consulta clave (`SELECT_ENCUENTRO` en `src/repositorios/encuentroRepo.js`): el
  encuentro no guarda `id_equipo_local`/`id_equipo_visitante`; guarda dos filas en
  `encuentro_equipo` con distinto `rol`. Se une `encuentro_equipo` y `equipo` **dos veces**,
  con alias distintos y el rol filtrado en el `ON`.

## Cómo correrlo

### 1. MySQL 8.0.16 o superior

Los `CHECK` se respetan desde 8.0.16 (antes se ignoraban en silencio); `db:setup` avisa si
la versión es menor.

**Con docker compose** (desde la raíz del monorepo):

```bash
docker compose up -d mysql
```

El contenedor (`mysql:8.4`, puerto 3306) ya crea la base `goldorado_deportes` y el usuario
`goldorado_app` / `GolDorado_App_2026!` con todos los permisos sobre ella.

**Con una instalación local** (MySQL Server / Workbench), como `root`, una sola vez:

```sql
CREATE USER IF NOT EXISTS 'goldorado_app'@'%' IDENTIFIED BY 'GolDorado_App_2026!';
GRANT ALL PRIVILEGES ON goldorado_deportes.* TO 'goldorado_app'@'%';
```

`ALL` sobre `goldorado_deportes.*` incluye borrar y crear **esa** base, que es lo que hace
`db:setup`; no da permisos sobre ninguna otra. Si el servidor tiene
`sql_require_primary_key=ON` (algunos MySQL administrados en la nube), las tablas de
rompimiento no se crean: no llevan llave primaria a propósito (decisión del modelo).

### 2. Variables de entorno

```bash
cp .env.example .env
```

Todas las variables están comentadas en `.env.example` (`GRPC_PUERTO`, `GRPC_HOST`,
`GRPC_TOKEN_INTERNO`, `LOG_NIVEL`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_SSL`).

### 3. Crear la base y cargar los datos

```bash
npm run db:setup                              # dentro de servicios/ms-deportes
npm run db:setup -w @goldorado/ms-deportes    # o desde la raíz
```

Corre `db/01_esquema.sql` (DROP + CREATE de la base) y `db/02_datos.sql` (una transacción),
imprime la verificación (filas por tabla, mínimo 2) y los encuentros por estado.
Si no puede conectarse, dice por qué (MySQL apagado, usuario o clave, permisos...).

### 4. Levantar el servicio y probar

```bash
npm run dev     # con nodemon
npm start
npm test        # node --test: sin MySQL y sin red
```

El servicio **arranca aunque MySQL esté caído**: abre el puerto, avisa en el log con una
pista concreta, `Salud` responde `estado: 'error'` con el detalle y, en cuanto MySQL vuelve,
el pool se reconecta solo.

## Datos semilla

Los mismos del monolito con los **ids fijos** de `docs/CONVENCIONES.md` (otras bases los
referencian): torneo 1..4, equipo 1..16 (MIL, NAL, AME, JUN, BOC, FLA, RIV, PAL, MCI, LIV,
ARS, CHE, RMA, BAR, ATM, SEV), jugador 1..12, encuentro 1..12 = `m-01`..`m-12`.

Las fechas son **relativas al momento del setup** (`UTC_TIMESTAMP()`): encuentros 1–4 en
vivo (kickoff = ahora − minuto), 5–8 próximos (+1..+4 días), 9–12 finalizados (−3..−6
días); jornada 1 = la semana pasada, jornada 2 = esta semana. Volver a correr `db:setup`
"refresca" la demo.

## Dónde están las consultas

| Archivo | Contenido |
|---|---|
| `db/01_esquema.sql` | las 15 tablas con TODAS las restricciones nombradas igual que en el monolito (`PK_`, `FK_`, `UQ_`, `CHK_`, `IX_`) y cada diferencia MySQL / SQL Server comentada |
| `db/02_datos.sql` | datos semilla (una transacción) + consulta de verificación |
| `db/03_consultas.sql` | consultas de sustentación: verificación del taller, SELECT, WHERE, JOIN, GROUP BY, subconsultas y ventanas, UPDATE seguro, violaciones de restricciones (errores 1062, 1452, 1451, 3819) y lo propio de MySQL (UNIQUE con varios NULL, posiciones con CTE + `RANK()`, `EXPLAIN FORMAT=TREE`, `JSON_ARRAYAGG`, `LATERAL`, `FIELD()`) |
| `src/repositorios/` | las consultas que ejecuta el servicio, siempre con `?` |

Diferencias con SQL Server que más se notan: el dorsal es un `UNIQUE (id_equipo, dorsal)`
normal porque en MySQL un índice único admite varios NULL (SQL Server necesitó un índice
filtrado); `SYSDATETIME()` → `UTC_TIMESTAMP()`; `OUTER APPLY ... TOP 1` → `LEFT JOIN LATERAL
(... LIMIT 1) ON TRUE`; `TOP` → `LIMIT`; `BIT` → `TINYINT(1)` con `CHECK (x IN (0,1))`;
`DEFAULT` no se puede nombrar en MySQL (el nombre `DF_` queda en un comentario) y la llave
primaria siempre se llama `PRIMARY`.

## Estructura

```
src/
  index.js                  entorno -> servidor gRPC -> MySQL sin bloquear -> apagado ordenado
  config/env.js             cargarEnv (@goldorado/comun)
  config/db.js              UN pool mysql2 (timezone 'Z', DATE como 'YYYY-MM-DD') + pistas de error
  grpc/handlers.js          traduce request <-> servicio (un método por rpc del .proto)
  servicios/deportesServicio.js   reglas: NOT_FOUND, filtro de estado, hidratación de colores
  servicios/reglas.js       funciones puras: estados, límites, ids
  servicios/mapeadores.js   fila -> mensaje del contrato (NULL -> ausente)
  repositorios/             encuentroRepo.js, catalogoRepo.js (SQL parametrizado)
db/                         01_esquema.sql, 02_datos.sql, 03_consultas.sql, setup.js
test/                       node --test con repositorios falsos + prueba de arranque sin MySQL
```
