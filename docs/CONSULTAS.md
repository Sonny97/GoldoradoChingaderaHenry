# Dónde están las consultas de cada base

Cada microservicio es **dueño de su base** y guarda su esquema, sus datos semilla y sus
**consultas de sustentación** en su propia carpeta `db/`. Este archivo es el índice.

| Base (tablero) | Servicio | Esquema | Datos | **Consultas** | Cómo se corren |
|---|---|---|---|---|---|
| SQL Server — *loguin* | `ms-autenticacion` | [01_esquema.sql](../servicios/ms-autenticacion/db/01_esquema.sql) | [02_datos.sql](../servicios/ms-autenticacion/db/02_datos.sql) | [03_consultas.sql](../servicios/ms-autenticacion/db/03_consultas.sql) | SSMS / Azure Data Studio, o `sqlcmd -S localhost,1433 -U goldorado_app -i db/03_consultas.sql` |
| MySQL — *Jugadores* | `ms-deportes` | [01_esquema.sql](../servicios/ms-deportes/db/01_esquema.sql) | [02_datos.sql](../servicios/ms-deportes/db/02_datos.sql) | [03_consultas.sql](../servicios/ms-deportes/db/03_consultas.sql) | MySQL Workbench, o `mysql -u goldorado_app -p goldorado_deportes < db/03_consultas.sql` |
| PostgreSQL — *API (Azure)* | `ms-apuestas` | [01_esquema.sql](../servicios/ms-apuestas/db/01_esquema.sql) | [02_datos.sql](../servicios/ms-apuestas/db/02_datos.sql) | [03_consultas.sql](../servicios/ms-apuestas/db/03_consultas.sql) | pgAdmin / Azure Data Studio, o `psql -h <host> -U goldorado_app -d goldorado_apuestas -f db/03_consultas.sql` |
| MongoDB — *transaccional y seguridad* | `ms-transacciones` | [01_colecciones.js](../servicios/ms-transacciones/db/01_colecciones.js) | [02_datos.js](../servicios/ms-transacciones/db/02_datos.js) | [03_consultas.js](../servicios/ms-transacciones/db/03_consultas.js) | MongoDB Compass (pestaña *mongosh*), o `mongosh mongodb://localhost:27017 db/03_consultas.js` |
| Firebase — *PSE (Wompi)* | `ms-pagos` | [ESTRUCTURA.md](../servicios/ms-pagos/db/ESTRUCTURA.md), [firestore.rules](../servicios/ms-pagos/db/firestore.rules), [firestore.indexes.json](../servicios/ms-pagos/db/firestore.indexes.json) | [02_datos.js](../servicios/ms-pagos/db/02_datos.js) | [03_consultas.js](../servicios/ms-pagos/db/03_consultas.js) | `node db/03_consultas.js` (Admin SDK; Firestore no tiene SQL) |
| Drive — *Imágenes* | `ms-imagenes` | [ESTRUCTURA.md](../servicios/ms-imagenes/db/ESTRUCTURA.md) | `npm run db:setup:imagenes` (sube 16 escudos) | [03_consultas.md](../servicios/ms-imagenes/db/03_consultas.md) | consultas `q` de la API de Drive, con su versión en Node y en curl |

`npm run db:setup` (en la raíz) crea y siembra todas las bases; `npm run db:setup:auth`,
`:deportes`, `:apuestas`, `:transacciones`, `:pagos`, `:imagenes` lo hacen de a una.
Todos los scripts son re-ejecutables y terminan con la verificación del taller:
**mínimo 2 registros por tabla o colección**.

## Qué hay en cada archivo de consultas

### SQL Server — `ms-autenticacion/db/03_consultas.sql`
1. Verificación: filas por tabla, restricciones con nombre, índices (incluidos los filtrados).
2. LEFT vs INNER JOIN: el administrador es `Usuario` pero no `Cliente`.
3. La consulta del login **tal como la ejecuta el servicio** (correo o documento, `OUTER APPLY TOP 1`).
4. Usuarios con perfil incompleto (entraron con Google/Microsoft y no tienen ficha).
5. Tabla `Sesion` ("token de seguridad"): sesiones activas, validación de un token, revocar una y todas.
6. Cuentas externas de Google y Microsoft por usuario.
7. Ciclo de vida de una solicitud de recuperación de contraseña (ahora persistida).
8. Violaciones a propósito con su número de error (2627, 2601, 547, 515) y el índice único filtrado de `reset_token`.
9. Nota: dónde quedó `Log_Sesion` (en MongoDB) y por qué.

### MySQL — `ms-deportes/db/03_consultas.sql`
Las del taller del monolito portadas a MySQL: verificación (15 tablas, ≥ 2 filas, FK y CHECK
con nombre), SELECT básico, WHERE y sus operadores, JOIN (la **consulta clave**: el encuentro
armado con dos JOIN a la misma tabla `equipo` filtrando el rol), GROUP BY / HAVING,
subconsultas, funciones de ventana, tabla de posiciones con CTE, UPDATE seguro, violaciones
(1062, 1452, 1451, 3819), y demostraciones propias de MySQL: dos dorsales `NULL` aceptados por
un `UNIQUE`, `EXPLAIN`, `JSON_ARRAYAGG` y `LATERAL`.
**Verificado contra MySQL 8.4.9:** 84 sentencias; las 14 que fallan son exactamente las
violaciones demostrativas.

### PostgreSQL — `ms-apuestas/db/03_consultas.sql`
Verificación (tablas, `pg_constraint`, índices parciales, columnas `IDENTITY` y `GENERATED`),
estado de cuenta con saldo acumulado por ventana, apuestas con su contexto, resumen con
`FILTER (WHERE …)`, funciones de ventana sobre cuotas (`ROW_NUMBER`, `DISTINCT ON`, `RANK`),
`LEFT JOIN LATERAL` (el `OUTER APPLY` de PostgreSQL), la bandeja de salida con
`FOR UPDATE SKIP LOCKED`, consultas `JSONB`, promociones vigentes, y violaciones capturadas
con su SQLSTATE (23505, 23514, 23503, 428C9).
**Verificado contra PostgreSQL 18.3:** corre completo; las 8 violaciones dan el SQLSTATE esperado.

### MongoDB — `ms-transacciones/db/03_consultas.js`
`find` con proyección y orden, **detección de fuerza bruta** (agregación de intentos fallidos
por correo en los últimos 15 minutos con IPs distintas), estado de cuenta por usuario
(`$group` con `Decimal128`), depósitos por día (`$dateTrunc`), el historial de estados con
`$unwind` (lo que era `Log_Transaccion`), `$lookup` entre colecciones, `$push` al historial,
violaciones del `$jsonSchema` (error 121) y del índice único (11000), `explain()` y el índice TTL.

### Firestore — `ms-pagos/db/03_consultas.js`
Pagos de un usuario ordenados, pendientes con más de N minutos, aprobados sin acreditar,
agregaciones `count()` y `sum()` por estado, `collectionGroup('eventos')` (últimos webhooks) y
un ejemplo de `runTransaction`. Los índices compuestos que necesitan están en
`firestore.indexes.json`.

### Google Drive — `ms-imagenes/db/03_consultas.md`
Drive hace de "base de datos" de imágenes: cada archivo lleva `appProperties`
(`entidad`, `idEntidad`). Las consultas son expresiones `q` de la API: todas las imágenes de
la app, por entidad, por entidad + id, las más recientes, por tipo MIME, en papelera, carpetas;
cada una con su código Node y su `curl`.
