-- ==============================================================================
--  GOLDORADO - ms-deportes
--  Motor: MySQL 8.0.16+ / 8.4       Archivo 3 de 3: CONSULTAS DE SUSTENTACION
--
--  Este archivo NO lo ejecuta npm run db:setup. Esta para abrirlo en MySQL
--  Workbench (o en el cliente mysql) y correr los bloques de a uno.
--
--  Son las consultas del monolito (server/db/03_consultas.sql) que caen en este
--  dominio, pasadas a MySQL, mas una seccion 9 con lo propio de MySQL. Las del
--  monolito que eran de usuarios, cuotas o apuestas viven ahora en las
--  consultas de ms-autenticacion y ms-apuestas; donde un ejemplo usaba esas
--  tablas, aqui se cambio por uno equivalente de este dominio.
--
--  Diferencias de dialecto que aparecen abajo:
--    TOP n             -> LIMIT n (al final de la consulta)
--    a + ' ' + b       -> CONCAT(a, ' ', b)   (en MySQL + siempre SUMA)
--    ISNULL(x, 0)      -> COALESCE(x, 0)      (ISNULL(x) de MySQL solo pregunta)
--    DECLARE @x = ...  -> SET @x = ...        (DECLARE solo existe en procedimientos)
--    OUTER APPLY       -> LEFT JOIN LATERAL (...) ON TRUE   (MySQL 8.0.14+)
--    SYSDATETIME()     -> UTC_TIMESTAMP()     (los datos se guardan en UTC)
--    sys.tables, ...   -> information_schema
--
--  Las fechas de 02_datos.sql son relativas al dia en que se cargo la base: por
--  eso aqui no hay fechas fijas como '2026-08-19', sino UTC_TIMESTAMP() +/- n.
-- ==============================================================================

USE goldorado_deportes;

-- ==============================================================================
-- 0. VERIFICACION DE LOS REQUISITOS DEL TALLER
-- ==============================================================================

-- 0.1 Cuantas tablas tiene la base (deben ser 15).
SELECT COUNT(*) AS total_tablas
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type = 'BASE TABLE';

-- 0.2 Filas por tabla, APROXIMADO. table_rows es la estimacion que InnoDB guarda
--     para el optimizador: no recorre nada (como sys.partitions en SQL Server),
--     pero puede ir desfasada hasta un ANALYZE TABLE y MySQL 8 ademas la cachea
--     (information_schema_stats_expiry). El conteo exacto es el de 0.3.
SELECT table_name AS tabla, table_rows AS filas_aprox
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type = 'BASE TABLE'
ORDER BY filas_aprox DESC, tabla;

-- 0.3 El requisito, con conteo EXACTO: ninguna tabla con menos de 2 registros.
--     Si esta consulta devuelve filas, esas tablas NO cumplen.
SELECT v.tabla AS tabla_incompleta, v.filas
FROM (
              SELECT 'pais' AS tabla, COUNT(*) AS filas FROM pais
    UNION ALL SELECT 'region',                        COUNT(*) FROM region
    UNION ALL SELECT 'ciudad',                        COUNT(*) FROM ciudad
    UNION ALL SELECT 'estadio',                       COUNT(*) FROM estadio
    UNION ALL SELECT 'torneo',                        COUNT(*) FROM torneo
    UNION ALL SELECT 'temporada',                     COUNT(*) FROM temporada
    UNION ALL SELECT 'equipo',                        COUNT(*) FROM equipo
    UNION ALL SELECT 'equipo_color',                  COUNT(*) FROM equipo_color
    UNION ALL SELECT 'jugador',                       COUNT(*) FROM jugador
    UNION ALL SELECT 'jornada',                       COUNT(*) FROM jornada
    UNION ALL SELECT 'encuentro',                     COUNT(*) FROM encuentro
    UNION ALL SELECT 'encuentro_equipo',              COUNT(*) FROM encuentro_equipo
    UNION ALL SELECT 'alineacion',                    COUNT(*) FROM alineacion
    UNION ALL SELECT 'estadistica_encuentro',         COUNT(*) FROM estadistica_encuentro
    UNION ALL SELECT 'estadistica_jugador_encuentro', COUNT(*) FROM estadistica_jugador_encuentro
) v
WHERE v.filas < 2;

-- 0.4 Todas las llaves foraneas, con su nombre: ninguna quedo con nombre
--     automatico (MySQL los inventaria como equipo_ibfk_1).
SELECT
    rc.constraint_name       AS restriccion,
    rc.table_name            AS tabla_hija,
    rc.referenced_table_name AS tabla_padre,
    rc.delete_rule           AS al_borrar_padre
FROM information_schema.referential_constraints rc
WHERE rc.constraint_schema = DATABASE()
ORDER BY tabla_hija, restriccion;

-- 0.5 Todas las restricciones CHECK con su regla (vista nueva en MySQL 8.0.16).
--     MySQL guarda la regla normalizada: con comillas invertidas y literales
--     como _utf8mb4'live'.
SELECT
    tc.table_name      AS tabla,
    cc.constraint_name AS restriccion,
    cc.check_clause    AS regla
FROM information_schema.check_constraints cc
JOIN information_schema.table_constraints tc
  ON tc.constraint_schema = cc.constraint_schema
 AND tc.constraint_name   = cc.constraint_name
 AND tc.constraint_type   = 'CHECK'
WHERE cc.constraint_schema = DATABASE()
ORDER BY tabla, restriccion;

-- 0.6 Indices con sus columnas. La llave primaria sale como PRIMARY: MySQL
--     ignora el nombre PK_x. Los demas son los UQ_ e IX_ del esquema.
SELECT
    s.table_name AS tabla,
    s.index_name AS indice,
    GROUP_CONCAT(s.column_name ORDER BY s.seq_in_index SEPARATOR ', ') AS columnas,
    IF(s.non_unique = 0, 'UNICO', '') AS tipo
FROM information_schema.statistics s
WHERE s.table_schema = DATABASE()
GROUP BY s.table_name, s.index_name, s.non_unique
ORDER BY tabla, indice;

-- ==============================================================================
-- 1. SELECT BASICO
-- ==============================================================================

-- 1.1 Todo el contenido de una tabla.
SELECT * FROM equipo;

-- 1.2 No siempre se necesitan todas las columnas.
SELECT nombre, codigo_corto, fundacion
FROM equipo;

-- 1.3 Alias para presentar mejor los resultados.
SELECT
    nombre       AS equipo,
    codigo_corto AS sigla,
    fundacion    AS fundado
FROM equipo;

-- 1.4 Columna calculada. OJO: en MySQL el + NO concatena, suma ('Diego' + ' '
--     da 0 con una advertencia): se usa CONCAT, que ademas convierte el numero
--     solo. La edad sale exacta con TIMESTAMPDIFF(YEAR, ...), que cuenta anios
--     cumplidos; el DATEDIFF(YEAR, ...) de T-SQL cuenta cambios de anio y le suma
--     uno a quien todavia no cumple.
SELECT
    CONCAT(nombres, ' ', apellidos) AS nombre_completo,
    posicion,
    dorsal,
    CONCAT(TIMESTAMPDIFF(YEAR, fecha_nacimiento, UTC_DATE()), ' años') AS edad
FROM jugador;

-- 1.5 DISTINCT: valores sin repetir. Sin el, saldria una fila por jugador.
SELECT DISTINCT posicion FROM jugador;

-- 1.6 LIMIT (el TOP de T-SQL) con ORDER BY. Sin ORDER BY "los 5 primeros" no
--     significa nada: el motor no garantiza ningun orden.
SELECT nombre, capacidad
FROM estadio
ORDER BY capacidad DESC
LIMIT 5;

-- ==============================================================================
-- 2. WHERE Y SUS OPERADORES
-- ==============================================================================

-- 2.1 Comparacion simple.
SELECT nombre, capacidad FROM estadio WHERE capacidad > 60000;
SELECT nombre, capacidad FROM estadio WHERE capacidad <= 40000;
SELECT nombre FROM estadio WHERE capacidad <> 54000;

-- 2.2 AND: se deben cumplir las dos condiciones. Proximos que se juegan dentro
--     de mas de dos dias (fecha relativa, no fija).
SELECT id_encuentro, estado, fecha_hora
FROM encuentro
WHERE estado = 'upcoming'
  AND fecha_hora > UTC_TIMESTAMP() + INTERVAL 2 DAY;

-- 2.3 OR: basta una.
SELECT nombre, codigo_corto FROM equipo
WHERE codigo_corto = 'MIL' OR codigo_corto = 'NAL';

-- 2.4 Combinar AND y OR con parentesis. SIN ellos, AND se evalua antes que OR y
--     saldrian los destacados en vivo MAS todos los proximos, destacados o no.
SELECT id_encuentro, estado, destacado
FROM encuentro
WHERE destacado = 1
  AND (estado = 'live' OR estado = 'upcoming');

-- 2.5 BETWEEN: los dos extremos SI se incluyen.
SELECT nombre, capacidad FROM estadio
WHERE capacidad BETWEEN 40000 AND 60000;

-- 2.6 IN: mas legible que encadenar OR.
SELECT nombre, codigo_corto FROM equipo
WHERE codigo_corto IN ('MIL', 'NAL', 'AME', 'JUN');

-- 2.7 LIKE: % es cualquier cantidad de caracteres, _ es exactamente uno.
SELECT nombre FROM equipo WHERE nombre LIKE 'A%';           -- empieza por A
SELECT nombre FROM equipo WHERE nombre LIKE '%Madrid';      -- termina en Madrid
SELECT nombre FROM equipo WHERE nombre LIKE '%tico%';       -- lo contiene
SELECT codigo_corto FROM equipo WHERE codigo_corto LIKE 'M__';  -- M y 2 mas
-- Con utf8mb4_0900_ai_ci el LIKE tampoco distingue tildes ni mayusculas:
-- 'atletico%' encuentra a Atlético Nacional y a Atlético Madrid.
SELECT nombre FROM equipo WHERE nombre LIKE 'atletico%';

-- 2.8 NULL. ERROR FRECUENTE: `= NULL` NUNCA devuelve nada. NULL es
--     "desconocido" y comparar dos desconocidos no da verdadero. Se usa IS NULL.
SELECT nombre, confederacion FROM torneo WHERE codigo_pais IS NULL;
SELECT nombre, codigo_pais   FROM torneo WHERE codigo_pais IS NOT NULL;
SELECT id_encuentro, estado  FROM encuentro WHERE minuto IS NULL;

-- Para comprobar el error: CERO filas aunque la Libertadores tenga codigo_pais NULL.
SELECT nombre FROM torneo WHERE codigo_pais = NULL;

-- Propio de MySQL: <=> es la igualdad "a prueba de NULL" (NULL <=> NULL vale 1).
SELECT nombre FROM torneo WHERE codigo_pais <=> NULL;

-- 2.9 ORDER BY con mas de una columna y direcciones distintas.
SELECT estado, fecha_hora, id_encuentro
FROM encuentro
ORDER BY estado ASC, fecha_hora DESC;

-- ==============================================================================
-- 3. JOIN: RECONSTRUIR LA INFORMACION REPARTIDA
-- ==============================================================================

-- 3.1 INNER JOIN sencillo: cada equipo con su ciudad y su pais.
--     Cuatro tablas encadenadas por la jerarquia pais -> region -> ciudad.
SELECT
    e.nombre  AS equipo,
    ci.nombre AS ciudad,
    r.nombre  AS region,
    p.nombre  AS pais
FROM equipo e
INNER JOIN ciudad ci ON ci.id_ciudad = e.id_ciudad
INNER JOIN region r  ON r.id_region  = ci.id_region
INNER JOIN pais   p  ON p.codigo_iso = r.codigo_pais
ORDER BY pais, ciudad, equipo;

-- 3.2 LA CONSULTA CLAVE DEL MODELO: el partido completo.
--
--     encuentro NO guarda id_equipo_local ni id_equipo_visitante. Guarda DOS
--     filas en encuentro_equipo con el mismo id_encuentro y distinto `rol`.
--     Para volver a armar el partido hay que unir encuentro_equipo y equipo DOS
--     VECES, con alias distintos y filtrando por rol EN EL ON.
--
--     Esa es la respuesta a "¿cual de los dos id_equipo se une a equipo?": los dos.
--     (Es la misma consulta de src/repositorios/encuentroRepo.js.)
SELECT
    e.id_encuentro                            AS partido,
    t.nombre                                  AS torneo,
    loc.nombre                                AS equipo_local,
    COALESCE(CAST(loc_ee.goles AS CHAR), '-') AS goles_local,
    COALESCE(CAST(vis_ee.goles AS CHAR), '-') AS goles_visitante,
    vis.nombre                                AS equipo_visitante,
    e.estado,
    es.nombre                                 AS estadio,
    e.fecha_hora                              AS kickoff_utc
FROM encuentro e
INNER JOIN jornada   j  ON j.id_jornada    = e.id_jornada
INNER JOIN temporada tm ON tm.id_temporada = j.id_temporada
INNER JOIN torneo    t  ON t.id_torneo     = tm.id_torneo
LEFT  JOIN estadio   es ON es.id_estadio   = e.id_estadio
INNER JOIN encuentro_equipo loc_ee ON loc_ee.id_encuentro = e.id_encuentro AND loc_ee.rol = 'LOCAL'
INNER JOIN equipo           loc    ON loc.id_equipo       = loc_ee.id_equipo
INNER JOIN encuentro_equipo vis_ee ON vis_ee.id_encuentro = e.id_encuentro AND vis_ee.rol = 'VISITANTE'
INNER JOIN equipo           vis    ON vis.id_equipo       = vis_ee.id_equipo
ORDER BY e.fecha_hora;

-- 3.3 LEFT JOIN: la diferencia con INNER se ve aqui. Hay estadios sin partidos
--     cargados (Maracaná, Anfield, el Roberto Meléndez y el Sánchez-Pizjuán).
--     Con LEFT JOIN aparecen con NULL en las columnas del encuentro; con INNER
--     JOIN desaparecen. (En el monolito el ejemplo era el administrador, que es
--     usuario pero no cliente; esas tablas ahora son de ms-autenticacion.)
SELECT es.nombre AS estadio, e.id_encuentro, e.estado
FROM estadio es
LEFT JOIN encuentro e ON e.id_estadio = es.id_estadio
ORDER BY es.nombre;

-- Comparar con INNER JOIN: los cuatro estadios sin partidos no salen.
SELECT es.nombre AS estadio, e.id_encuentro, e.estado
FROM estadio es
INNER JOIN encuentro e ON e.id_estadio = es.id_estadio
ORDER BY es.nombre;

-- 3.4 LA ALINEACION DEL DETALLE, tal como la ejecuta el servicio
--     (src/repositorios/encuentroRepo.js -> alineacion()). LEFT JOIN a la
--     estadistica: un jugador alineado sin estadistica cargada sigue saliendo,
--     con 0 goles. DECLARE @x de T-SQL es aqui una variable de usuario SET @x.
SET @id_encuentro = 1;

SELECT
    a.es_titular,
    COALESCE(a.posicion_juego, ju.posicion) AS posicion,
    CONCAT(ju.nombres, ' ', ju.apellidos)   AS jugador,
    ju.dorsal,
    eq.nombre                               AS equipo,
    COALESCE(ej.goles, 0)                   AS goles,
    COALESCE(ej.asistencias, 0)             AS asistencias,
    ej.minutos_jugados
FROM alineacion a
JOIN jugador ju ON ju.id_jugador = a.id_jugador
JOIN equipo  eq ON eq.id_equipo  = ju.id_equipo
LEFT JOIN estadistica_jugador_encuentro ej
       ON ej.id_encuentro = a.id_encuentro
      AND ej.id_jugador   = a.id_jugador
WHERE a.id_encuentro = @id_encuentro
ORDER BY ju.id_equipo, ju.dorsal IS NULL, ju.dorsal;

-- ==============================================================================
-- 4. AGRUPAMIENTO
-- ==============================================================================

-- 4.1 Cuantos equipos hay por torneo.
SELECT
    t.nombre AS torneo,
    COUNT(*) AS equipos
FROM equipo e
INNER JOIN torneo t ON t.id_torneo = e.id_torneo
GROUP BY t.nombre
ORDER BY equipos DESC;

-- 4.2 WHERE vs HAVING. NO son lo mismo:
--     WHERE  filtra FILAS antes de agrupar.
--     HAVING filtra GRUPOS despues de agrupar, y puede usar COUNT/SUM/AVG.
--     Poner COUNT(*) en el WHERE es error (1111, "Invalid use of group function"):
--     cuando el WHERE se evalua, los grupos todavia no existen.
SELECT
    t.nombre AS torneo,
    COUNT(*) AS partidos_jugados
FROM encuentro e
INNER JOIN jornada   j  ON j.id_jornada    = e.id_jornada
INNER JOIN temporada tm ON tm.id_temporada = j.id_temporada
INNER JOIN torneo    t  ON t.id_torneo     = tm.id_torneo
WHERE e.estado = 'finished'          -- filtra filas
GROUP BY t.nombre
HAVING COUNT(*) >= 1                 -- filtra grupos
ORDER BY partidos_jugados DESC;

-- 4.3 Goleadores. SUM sobre la tabla de rompimiento de estadistica.
--     Con ONLY_FULL_GROUP_BY (activo por defecto en MySQL 8) todo lo que se
--     muestra sin agregar tiene que estar en el GROUP BY.
SELECT
    CONCAT(ju.nombres, ' ', ju.apellidos) AS jugador,
    eq.nombre                             AS equipo,
    SUM(ej.goles)                         AS goles,
    SUM(ej.asistencias)                   AS asistencias,
    COUNT(*)                              AS partidos_jugados
FROM estadistica_jugador_encuentro ej
INNER JOIN jugador ju ON ju.id_jugador = ej.id_jugador
INNER JOIN equipo  eq ON eq.id_equipo  = ju.id_equipo
GROUP BY ju.id_jugador, ju.nombres, ju.apellidos, eq.nombre
HAVING SUM(ej.goles) > 0
ORDER BY goles DESC, asistencias DESC;

-- 4.4 COUNT(*) y COUNT(columna) NO son lo mismo: COUNT(columna) ignora los
--     NULL. Hay 12 encuentros, pero solo los 4 en vivo tienen minuto.
SELECT
    COUNT(*)          AS total_encuentros,
    COUNT(minuto)     AS con_minuto_registrado,
    COUNT(id_estadio) AS con_sede
FROM encuentro;

-- 4.5 Promedios por torneo (el monolito promediaba cuotas, que ahora son de
--     ms-apuestas). Diferencia con T-SQL: alla AVG de una columna INT devuelve
--     INT y trunca; MySQL devuelve DECIMAL.
SELECT
    t.nombre                                         AS torneo,
    COUNT(*)                                         AS partidos_con_estadistica,
    ROUND(AVG(s.tiros_local + s.tiros_visitante), 2) AS tiros_por_partido,
    MIN(s.posesion_local)                            AS posesion_local_minima,
    MAX(s.posesion_local)                            AS posesion_local_maxima
FROM estadistica_encuentro s
INNER JOIN encuentro e  ON e.id_encuentro  = s.id_encuentro
INNER JOIN jornada   j  ON j.id_jornada    = e.id_jornada
INNER JOIN temporada tm ON tm.id_temporada = j.id_temporada
INNER JOIN torneo    t  ON t.id_torneo     = tm.id_torneo
GROUP BY t.id_torneo, t.nombre
ORDER BY tiros_por_partido DESC;

-- ==============================================================================
-- 5. SUBCONSULTAS Y FUNCIONES DE VENTANA
-- ==============================================================================

-- 5.1 Subconsulta en el WHERE: estadios con capacidad sobre el promedio.
SELECT nombre, capacidad
FROM estadio
WHERE capacidad > (SELECT AVG(capacidad) FROM estadio)
ORDER BY capacidad DESC;

-- 5.2 EXISTS: equipos que ya tienen al menos un partido.
--     EXISTS corta en cuanto encuentra la primera coincidencia; no cuenta.
SELECT e.nombre
FROM equipo e
WHERE EXISTS (
    SELECT 1 FROM encuentro_equipo ee WHERE ee.id_equipo = e.id_equipo
);

-- 5.3 NOT EXISTS: equipos SIN partidos programados.
SELECT e.nombre
FROM equipo e
WHERE NOT EXISTS (
    SELECT 1 FROM encuentro_equipo ee WHERE ee.id_equipo = e.id_equipo
);

-- 5.4 Funcion de ventana: el estadio mas grande de cada pais (el monolito
--     buscaba la cuota mas alta de cada partido). ROW_NUMBER numera dentro de
--     cada grupo (PARTITION BY) sin colapsar las filas, que es lo que si haria
--     un GROUP BY. En MySQL toda tabla derivada necesita alias (error 1248).
SELECT pais, estadio, capacidad
FROM (
    SELECT
        p.nombre   AS pais,
        es.nombre  AS estadio,
        es.capacidad,
        ROW_NUMBER() OVER (PARTITION BY p.codigo_iso ORDER BY es.capacidad DESC) AS orden
    FROM estadio es
    INNER JOIN ciudad ci ON ci.id_ciudad  = es.id_ciudad
    INNER JOIN region r  ON r.id_region   = ci.id_region
    INNER JOIN pais   p  ON p.codigo_iso  = r.codigo_pais
) x
WHERE orden = 1
ORDER BY capacidad DESC;

-- 5.5 Tabla de posiciones, calculada. No se guarda: se deduce del marcador, y
--     guardarla seria un dato derivado que se puede desincronizar.
--     WITH (CTE) existe en MySQL desde 8.0.
WITH resultados AS (
    SELECT
        ee.id_equipo,
        ee.goles    AS goles_favor,
        rival.goles AS goles_contra
    FROM encuentro_equipo ee
    INNER JOIN encuentro e ON e.id_encuentro = ee.id_encuentro
    INNER JOIN encuentro_equipo rival
            ON rival.id_encuentro = ee.id_encuentro
           AND rival.id_equipo   <> ee.id_equipo
    WHERE e.estado = 'finished'
)
SELECT
    eq.nombre                                                         AS equipo,
    COUNT(*)                                                          AS pj,
    SUM(CASE WHEN r.goles_favor >  r.goles_contra THEN 1 ELSE 0 END) AS ganados,
    SUM(CASE WHEN r.goles_favor =  r.goles_contra THEN 1 ELSE 0 END) AS empatados,
    SUM(CASE WHEN r.goles_favor <  r.goles_contra THEN 1 ELSE 0 END) AS perdidos,
    SUM(r.goles_favor)                                                AS gf,
    SUM(r.goles_contra)                                               AS gc,
    SUM(r.goles_favor) - SUM(r.goles_contra)                          AS diferencia,
    SUM(CASE WHEN r.goles_favor > r.goles_contra THEN 3
             WHEN r.goles_favor = r.goles_contra THEN 1
             ELSE 0 END)                                              AS puntos
FROM resultados r
INNER JOIN equipo eq ON eq.id_equipo = r.id_equipo
GROUP BY eq.id_equipo, eq.nombre
ORDER BY puntos DESC, diferencia DESC;

-- ==============================================================================
-- 6. UPDATE SEGURO
--
--  REGLA DE ORO: primero el SELECT con EXACTAMENTE el mismo WHERE, y despues el
--  UPDATE. Un UPDATE sin WHERE modifica la tabla entera y no hay CTRL+Z.
--  MySQL Workbench trae activo "safe updates" (SQL_SAFE_UPDATES=1): rechaza con
--  el error 1175 un UPDATE o DELETE cuyo WHERE no use una llave. Es la regla de
--  oro convertida en configuracion.
-- ==============================================================================

-- 6.1 Cambiar una sola columna.
SELECT id_encuentro, estado, minuto FROM encuentro WHERE id_encuentro = 1;

UPDATE encuentro
   SET minuto = 75
 WHERE id_encuentro = 1;

SELECT id_encuentro, estado, minuto FROM encuentro WHERE id_encuentro = 1;

-- Se devuelve a como estaba, para no dejar la base alterada.
UPDATE encuentro SET minuto = 67 WHERE id_encuentro = 1;

-- 6.2 Cambiar varias columnas a la vez: se cierra un partido. Esta vez dentro
--     de una transaccion: se mira el resultado y se deshace con ROLLBACK, sin
--     escribir el UPDATE inverso (InnoDB es transaccional).
SELECT id_encuentro, estado, minuto FROM encuentro WHERE id_encuentro = 1;

START TRANSACTION;

UPDATE encuentro
   SET estado = 'finished',
       minuto = NULL          -- un partido terminado ya no va por ningun minuto
 WHERE id_encuentro = 1;

SELECT id_encuentro, estado, minuto FROM encuentro WHERE id_encuentro = 1;

ROLLBACK;

SELECT id_encuentro, estado, minuto FROM encuentro WHERE id_encuentro = 1;   -- otra vez 'live', 67

-- (La seccion 7 del monolito, eliminacion logica vs DELETE fisico, era sobre
--  usuarios y promociones: esta en las consultas de ms-autenticacion y
--  ms-apuestas. Se conserva la numeracion para poder comparar los archivos.)

-- ==============================================================================
-- 8. QUE PASA CUANDO SE VIOLA UNA RESTRICCION
--
--  Cada bloque falla A PROPOSITO. Se corren de a uno para ver el codigo de error
--  y el NOMBRE de la restriccion que lo impidio: por eso todas van nombradas.
--  Codigos de MySQL: 1062 duplicado (PK/UNIQUE), 1452 hijo sin padre (FK),
--  1451 padre con hijos (FK), 3819 CHECK violado. (En SQL Server eran 2627 y 547.)
--  MySQL 8 trabaja en modo estricto (STRICT_TRANS_TABLES): sin el, algunos
--  valores invalidos se "arreglaban" en silencio con solo una advertencia.
-- ==============================================================================

-- 8.1 PRIMARY KEY repetida.  -> 1062 Duplicate entry 'COL' for key 'pais.PRIMARY'
--     (MySQL llama PRIMARY a toda llave primaria: el nombre PK_Pais no aparece).
INSERT INTO pais (codigo_iso, nombre) VALUES ('COL', 'Colombia Otra Vez');

-- 8.2 FOREIGN KEY que no existe.  -> 1452, CONSTRAINT `FK_Region_Pais`
INSERT INTO region (codigo_pais, nombre) VALUES ('XXX', 'Region Fantasma');

-- 8.3 UNIQUE repetido: dos jugadores de Millonarios con el 9.
--     -> 1062, key 'jugador.UQ_Jugador_Dorsal'. Detalle de InnoDB: el id
--     AUTO_INCREMENT que alcanzo a reservar este INSERT fallido no se devuelve
--     (quedan "huecos" en los ids, y esta bien: un id no es un contador).
INSERT INTO jugador (id_equipo, nombres, apellidos, fecha_nacimiento, posicion, dorsal)
VALUES (1, 'Falso', 'Duplicado', '2000-01-01', 'DELANTERO', 9);

-- 8.4 CHECK de dominio: un estado que no existe.
--     -> 3819 Check constraint 'CHK_Encuentro_Estado' is violated.
UPDATE encuentro SET estado = 'aplazado' WHERE id_encuentro = 1;

-- 8.5 CHECK de negocio: un minuto imposible (el monolito usaba una cuota menor
--     que 1, que ahora es de ms-apuestas).  -> 3819, CHK_Encuentro_Minuto
UPDATE encuentro SET minuto = 200 WHERE id_encuentro = 1;

-- 8.6 CHECK de ambito: un torneo con pais Y confederacion.
--     -> 3819, CHK_Torneo_Ambito
INSERT INTO torneo (codigo_pais, confederacion, nombre)
VALUES ('COL', 'CONMEBOL', 'Torneo Imposible');

-- 8.7 El mismo CHECK, al reves: sin pais y sin confederacion.
INSERT INTO torneo (codigo_pais, confederacion, nombre)
VALUES (NULL, NULL, 'Torneo Huerfano');

-- 8.8 CHECK de coherencia: la posesion no suma 100.
--     -> 3819, CHK_EstEnc_PosesionSuma
UPDATE estadistica_encuentro
   SET posesion_local = 60, posesion_visitante = 70
 WHERE id_encuentro = 1;

-- 8.9 CHECK entre columnas: mas pases completados que intentados (Restrepo
--     intento 47 en el partido 1).  -> 3819, CHK_EstJugador_Pases
UPDATE estadistica_jugador_encuentro
   SET pases_completados = 60
 WHERE id_encuentro = 1 AND id_jugador = 2;

-- 8.10 Goles negativos.  -> 3819, CHK_EncuentroEquipo_Goles
UPDATE encuentro_equipo SET goles = -1 WHERE id_encuentro = 1 AND rol = 'LOCAL';

-- 8.11 Un equipo enfrentandose a si mismo.
--      -> 1062, key 'encuentro_equipo.UQ_EncuentroEquipo_Equipo'
--      La forma del monolito (SET id_equipo = (SELECT ... FROM encuentro_equipo))
--      ni siquiera llega al UNIQUE en MySQL: falla antes con 1093 ("You can't
--      specify target table for update in FROM clause"). Lo idiomatico es el
--      UPDATE de varias tablas, uniendo la tabla consigo misma:
UPDATE encuentro_equipo vis
INNER JOIN encuentro_equipo loc
        ON loc.id_encuentro = vis.id_encuentro
       AND loc.rol = 'LOCAL'
   SET vis.id_equipo = loc.id_equipo
 WHERE vis.id_encuentro = 1
   AND vis.rol = 'VISITANTE';

-- 8.12 Borrar un pais que tiene hijos colgando.
--      -> 1451 Cannot delete or update a parent row. El mensaje nombra la primera
--      FK que encuentra (FK_Region_Pais, FK_Torneo_Pais o FK_Jugador_Pais): las
--      tres protegen a Colombia. La FK cuida las dos direcciones: impide crear
--      huerfanos e impide dejarlos huerfanos.
DELETE FROM pais WHERE codigo_iso = 'COL';

-- 8.13 Un rol de color que no existe (el monolito escribia en una columna
--      calculada de apuesta, que ahora es de ms-apuestas).
--      -> 3819, CHK_EquipoColor_Rol
INSERT INTO equipo_color (id_equipo, rol_color, valor_hex) VALUES (1, 'TERTIARY', '#000000');

-- ==============================================================================
-- 9. PROPIO DE MYSQL
-- ==============================================================================

-- 9.1 Dos dorsales NULL en el mismo equipo SI se aceptan.
--     En SQL Server un UNIQUE trata dos NULL como iguales y el monolito tuvo que
--     usar un indice unico FILTRADO (WHERE dorsal IS NOT NULL). En MySQL un
--     indice unico admite varios NULL, asi que UQ_Jugador_Dorsal es un UNIQUE
--     normal y dice lo mismo. Todo dentro de una transaccion que se deshace.
START TRANSACTION;

INSERT INTO jugador (id_equipo, nombres, apellidos, fecha_nacimiento, posicion, dorsal) VALUES
    (1, 'Juvenil', 'Uno', '2007-02-01', 'DEFENSA', NULL),
    (1, 'Juvenil', 'Dos', '2007-05-09', 'DEFENSA', NULL);     -- entran los dos

SELECT id_jugador, nombres, apellidos, dorsal
FROM jugador
WHERE id_equipo = 1
ORDER BY dorsal IS NULL, dorsal;

-- Pero un dorsal REAL repetido sigue prohibido.  -> 1062, UQ_Jugador_Dorsal
-- Ojo: en MySQL un error dentro de la transaccion deshace SOLO esa sentencia; la
-- transaccion sigue abierta con los dos juveniles (por eso el ROLLBACK de abajo).
INSERT INTO jugador (id_equipo, nombres, apellidos, fecha_nacimiento, posicion, dorsal)
VALUES (1, 'Juvenil', 'Tres', '2007-08-15', 'DELANTERO', 9);

ROLLBACK;

-- 9.2 Tabla de posiciones POR TORNEO con CTE + funciones de ventana.
--     RANK() da la posicion dentro de cada torneo (empates comparten puesto) y
--     SUM(...) OVER (PARTITION BY ...) agrega sin colapsar filas. Ademas, en
--     MySQL una comparacion vale 0 o 1 y se puede sumar: SUM(gf > gc) = ganados.
WITH resultados AS (
    SELECT
        tm.id_torneo,
        ee.id_equipo,
        ee.goles    AS goles_favor,
        rival.goles AS goles_contra
    FROM encuentro_equipo ee
    INNER JOIN encuentro e   ON e.id_encuentro  = ee.id_encuentro
    INNER JOIN jornada   j   ON j.id_jornada    = e.id_jornada
    INNER JOIN temporada tm  ON tm.id_temporada = j.id_temporada
    INNER JOIN encuentro_equipo rival
            ON rival.id_encuentro = ee.id_encuentro
           AND rival.id_equipo   <> ee.id_equipo
    WHERE e.estado = 'finished'
),
tabla AS (
    SELECT
        id_torneo,
        id_equipo,
        COUNT(*)                          AS pj,
        SUM(goles_favor >  goles_contra)  AS ganados,
        SUM(goles_favor =  goles_contra)  AS empatados,
        SUM(goles_favor <  goles_contra)  AS perdidos,
        SUM(goles_favor)                  AS gf,
        SUM(goles_contra)                 AS gc,
        SUM(goles_favor) - SUM(goles_contra) AS diferencia,
        SUM(CASE WHEN goles_favor > goles_contra THEN 3
                 WHEN goles_favor = goles_contra THEN 1
                 ELSE 0 END)              AS puntos
    FROM resultados
    GROUP BY id_torneo, id_equipo
)
SELECT
    t.nombre AS torneo,
    RANK() OVER (PARTITION BY tb.id_torneo
                 ORDER BY tb.puntos DESC, tb.diferencia DESC, tb.gf DESC) AS posicion,
    eq.nombre AS equipo,
    tb.pj, tb.ganados, tb.empatados, tb.perdidos, tb.gf, tb.gc, tb.diferencia, tb.puntos,
    SUM(tb.puntos) OVER (PARTITION BY tb.id_torneo) AS puntos_repartidos_en_el_torneo
FROM tabla tb
INNER JOIN torneo t  ON t.id_torneo  = tb.id_torneo
INNER JOIN equipo eq ON eq.id_equipo = tb.id_equipo
ORDER BY t.id_torneo, posicion;

-- 9.3 EXPLAIN de la consulta principal del servicio (partidos en vivo por
--     relevancia). FORMAT=TREE existe desde 8.0.16; EXPLAIN ANALYZE (8.0.18+)
--     ademas la ejecuta y muestra tiempos reales.
--     Que mirar: loc_ee y vis_ee entran por UQ_EncuentroEquipo_Rol con las DOS
--     columnas (id_encuentro, rol) por igualdad, porque el rol se filtra en el
--     ON; equipo, ciudad, jornada, temporada y torneo entran por su PRIMARY. El
--     ORDER BY CASE no puede salir de un indice: aparece un "Sort".
EXPLAIN FORMAT=TREE
SELECT
    e.id_encuentro, e.estado, e.fecha_hora, e.minuto,
    t.nombre AS torneo,
    loc_eq.nombre AS equipo_local, loc_ee.goles AS goles_local,
    vis_eq.nombre AS equipo_visitante, vis_ee.goles AS goles_visitante
FROM encuentro e
JOIN jornada   j  ON j.id_jornada    = e.id_jornada
JOIN temporada tm ON tm.id_temporada = j.id_temporada
JOIN torneo    t  ON t.id_torneo     = tm.id_torneo
LEFT JOIN pais    p  ON p.codigo_iso  = t.codigo_pais
LEFT JOIN estadio es ON es.id_estadio = e.id_estadio
JOIN encuentro_equipo loc_ee ON loc_ee.id_encuentro = e.id_encuentro AND loc_ee.rol = 'LOCAL'
JOIN equipo           loc_eq ON loc_eq.id_equipo    = loc_ee.id_equipo
JOIN ciudad           loc_ci ON loc_ci.id_ciudad    = loc_eq.id_ciudad
JOIN encuentro_equipo vis_ee ON vis_ee.id_encuentro = e.id_encuentro AND vis_ee.rol = 'VISITANTE'
JOIN equipo           vis_eq ON vis_eq.id_equipo    = vis_ee.id_equipo
JOIN ciudad           vis_ci ON vis_ci.id_ciudad    = vis_eq.id_ciudad
WHERE e.estado = 'live'
ORDER BY
    CASE e.estado WHEN 'live' THEN 0 WHEN 'upcoming' THEN 1
                  WHEN 'finished' THEN 2 WHEN 'canceled' THEN 3 ELSE 4 END,
    e.fecha_hora;

-- La forma clasica (tabla), para comparar las columnas type/key/rows.
EXPLAIN
SELECT e.id_encuentro, loc_eq.nombre, vis_eq.nombre
FROM encuentro e
JOIN encuentro_equipo loc_ee ON loc_ee.id_encuentro = e.id_encuentro AND loc_ee.rol = 'LOCAL'
JOIN equipo           loc_eq ON loc_eq.id_equipo    = loc_ee.id_equipo
JOIN encuentro_equipo vis_ee ON vis_ee.id_encuentro = e.id_encuentro AND vis_ee.rol = 'VISITANTE'
JOIN equipo           vis_eq ON vis_eq.id_equipo    = vis_ee.id_equipo
WHERE e.id_encuentro IN (SELECT ee.id_encuentro FROM encuentro_equipo ee WHERE ee.id_equipo = 1);

-- 9.4 JSON_ARRAYAGG: los colores de cada equipo en UNA columna JSON.
--     Es la alternativa a la segunda consulta que hace el servicio (IN (...) y
--     agrupar en memoria). El servicio no la usa para mapear igual que con los
--     otros motores, y porque JSON_ARRAYAGG no garantiza el orden de los
--     elementos; JSON_OBJECTAGG si deja cada color bajo su rol.
SELECT
    eq.id_equipo,
    eq.nombre,
    JSON_ARRAYAGG(JSON_OBJECT('rol', ec.rol_color, 'hex', ec.valor_hex)) AS colores,
    JSON_OBJECTAGG(ec.rol_color, ec.valor_hex)                           AS colores_por_rol
FROM equipo eq
INNER JOIN equipo_color ec ON ec.id_equipo = eq.id_equipo
GROUP BY eq.id_equipo, eq.nombre
ORDER BY eq.id_equipo;

-- 9.5 La temporada vigente de cada torneo con LATERAL (el OUTER APPLY ... TOP 1
--     de T-SQL). Es la consulta de ListarTorneos (src/repositorios/catalogoRepo.js).
--     La Liga BetPlay tiene dos temporadas; sale solo la ultima que empezo.
SELECT
    t.id_torneo,
    t.nombre,
    COALESCE(p.nombre, t.confederacion) AS pais,
    tm.etiqueta                         AS temporada_vigente,
    tm.fecha_inicio
FROM torneo t
LEFT JOIN pais p ON p.codigo_iso = t.codigo_pais
LEFT JOIN LATERAL (
    SELECT tp.etiqueta, tp.fecha_inicio
    FROM temporada tp
    WHERE tp.id_torneo = t.id_torneo
    ORDER BY tp.fecha_inicio DESC
    LIMIT 1
) tm ON TRUE
ORDER BY t.id_torneo;

-- Lo mismo sin LATERAL (MySQL anterior a 8.0.14): subconsulta correlacionada.
-- Sirve para UNA columna; LATERAL puede traer varias de la misma fila.
SELECT
    t.id_torneo,
    t.nombre,
    (SELECT tp.etiqueta
       FROM temporada tp
      WHERE tp.id_torneo = t.id_torneo
      ORDER BY tp.fecha_inicio DESC
      LIMIT 1) AS temporada_vigente
FROM torneo t
ORDER BY t.id_torneo;

-- Por que hace falta: con un JOIN normal la Liga BetPlay sale dos veces.
SELECT t.nombre, tp.etiqueta, tp.fecha_inicio
FROM torneo t
INNER JOIN temporada tp ON tp.id_torneo = t.id_torneo
ORDER BY t.id_torneo, tp.fecha_inicio DESC;

-- 9.6 FIELD(): el orden de relevancia escrito "a lo MySQL". Devuelve la
--     posicion del valor en la lista (0 si no esta). El servicio usa CASE porque
--     es estandar y se lee igual en cualquier motor.
SELECT id_encuentro, estado, fecha_hora
FROM encuentro
ORDER BY FIELD(estado, 'live', 'upcoming', 'finished', 'canceled'), fecha_hora;
