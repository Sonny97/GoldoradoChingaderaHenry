-- ==============================================================================
--  GOLDORADO - ms-deportes
--  Motor: MySQL 8.0.16+ / 8.4                         Archivo 2 de 3: DATOS
--
--  Los mismos datos del monolito (server/db/02_datos.sql), que a su vez salian
--  de src/data/ (leagues.js, teams.js, matches.js): la pantalla y la consulta SQL
--  dicen lo mismo. Requisito del taller: minimo 2 registros por tabla; la
--  consulta de verificacion esta al final.
--
--  DOS CAMBIOS RESPECTO DEL MONOLITO (docs/CONVENCIONES.md, seccion 5)
--
--  1) Aqui SI se escriben los ids a mano. El monolito resolvia cada llave por su
--     clave natural porque todo vivia en una sola base. Ahora otras bases guardan
--     estos ids SIN llave foranea (ms-apuestas: cuota_oferta.id_encuentro y
--     promocion_torneo.id_torneo; ms-imagenes: el escudo del equipo 1..16), asi
--     que torneo 1..4, equipo 1..16, jugador 1..12 y encuentro 1..12 tienen que
--     ser los mismos en cualquier maquina. Con ids fijos sobran las tablas
--     temporales y las subconsultas; tambien se fijan los de las tablas internas
--     para que los datos sean identicos en todas partes.
--     MySQL no pide SET IDENTITY_INSERT: un AUTO_INCREMENT acepta el id explicito
--     y despues sigue contando desde el mayor.
--
--  2) Las fechas son RELATIVAS al momento en que se corre el script
--     (UTC_TIMESTAMP(), no SYSDATETIME(), porque la base guarda UTC). Asi la demo
--     nunca muestra un partido "proximo" en el pasado:
--       encuentros 1-4  en vivo     -> kickoff = ahora - minuto
--       encuentros 5-8  proximos    -> +1..+4 dias, a la misma hora del monolito
--       encuentros 9-12 finalizados -> -3..-6 dias
--       jornada 1 = la semana pasada, jornada 2 = esta semana.
--
--  Todo va en una transaccion: o queda la base completa o no queda nada. MySQL no
--  tiene SET XACT_ABORT; el equivalente es que el cliente se detenga en el primer
--  error (el cliente mysql lo hace solo y db/setup.js hace ROLLBACK) y al cerrar
--  la conexion la transaccion abierta se deshace.
-- ==============================================================================

USE goldorado_deportes;

-- El archivo esta en UTF-8: que el cliente lo envie como tal (en la consola de
-- Windows el cliente mysql puede asumir otro juego de caracteres).
SET NAMES utf8mb4;

-- Un solo "ahora" para todo el script, en UTC.
SET @ahora = UTC_TIMESTAMP();
SET @hoy   = DATE(@ahora);
SET @anio  = YEAR(@hoy);

-- Etiquetas de temporada coherentes con la fecha de hoy.
-- Liga BetPlay: dos torneos por anio (I y II).
SET @semestre_actual   = CONCAT(@anio, IF(MONTH(@hoy) <= 6, '-I', '-II'));
SET @semestre_anterior = IF(MONTH(@hoy) <= 6, CONCAT(@anio - 1, '-II'), CONCAT(@anio, '-I'));
-- Ligas europeas: la temporada arranca en agosto y cruza el anio ('2026/27').
SET @temporada_europea = IF(MONTH(@hoy) >= 7,
                            CONCAT(@anio, '/', RIGHT(@anio + 1, 2)),
                            CONCAT(@anio - 1, '/', RIGHT(@anio, 2)));

START TRANSACTION;

-- ==============================================================================
-- 1. GEOGRAFIA   pais -> region -> ciudad -> estadio
-- ==============================================================================

-- Sin prefijo N'...': la base es utf8mb4, la enie y las tildes se guardan bien.
INSERT INTO pais (codigo_iso, nombre) VALUES
    ('COL', 'Colombia'),
    ('ARG', 'Argentina'),
    ('BRA', 'Brasil'),
    ('ENG', 'Inglaterra'),
    ('ESP', 'España');

INSERT INTO region (id_region, codigo_pais, nombre) VALUES
    ( 1, 'COL', 'Cundinamarca'),
    ( 2, 'COL', 'Antioquia'),
    ( 3, 'COL', 'Valle del Cauca'),
    ( 4, 'COL', 'Atlántico'),
    ( 5, 'ARG', 'Buenos Aires'),
    ( 6, 'BRA', 'Río de Janeiro'),
    ( 7, 'BRA', 'São Paulo'),
    ( 8, 'ENG', 'Gran Mánchester'),
    ( 9, 'ENG', 'Merseyside'),
    (10, 'ENG', 'Gran Londres'),
    (11, 'ESP', 'Comunidad de Madrid'),
    (12, 'ESP', 'Cataluña'),
    (13, 'ESP', 'Andalucía');

INSERT INTO ciudad (id_ciudad, id_region, nombre) VALUES
    ( 1,  1, 'Bogotá'),
    ( 2,  2, 'Medellín'),
    ( 3,  3, 'Cali'),
    ( 4,  4, 'Barranquilla'),
    ( 5,  5, 'Buenos Aires'),
    ( 6,  6, 'Río de Janeiro'),
    ( 7,  7, 'São Paulo'),
    ( 8,  8, 'Mánchester'),
    ( 9,  9, 'Liverpool'),
    (10, 10, 'Londres'),
    (11, 11, 'Madrid'),
    (12, 12, 'Barcelona'),
    (13, 13, 'Sevilla');

INSERT INTO estadio (id_estadio, id_ciudad, nombre, capacidad) VALUES
    ( 1,  1, 'El Campín',                      36343),
    ( 2,  2, 'Atanasio Girardot',              40043),
    ( 3,  3, 'Pascual Guerrero',               35405),
    ( 4,  4, 'Metropolitano Roberto Meléndez', 46692),
    ( 5,  5, 'La Bombonera',                   54000),
    ( 6,  5, 'Monumental',                     83214),
    ( 7,  7, 'Allianz Parque',                 43713),
    ( 8,  6, 'Maracaná',                       78838),
    ( 9,  8, 'Etihad Stadium',                 53400),
    (10,  9, 'Anfield',                        61276),
    (11, 10, 'Emirates Stadium',               60704),
    (12, 10, 'Stamford Bridge',                40343),
    (13, 11, 'Santiago Bernabéu',              78297),
    (14, 11, 'Metropolitano',                  70460),
    (15, 12, 'Spotify Camp Nou',               99354),
    (16, 13, 'Ramón Sánchez-Pizjuán',          43883);

-- ==============================================================================
-- 2. TORNEOS, TEMPORADAS Y JORNADAS
-- ==============================================================================

-- La Copa Libertadores va con codigo_pais NULL y confederacion 'CONMEBOL':
-- CHK_Torneo_Ambito obliga a que sea exactamente uno de los dos.
INSERT INTO torneo (id_torneo, codigo_pais, confederacion, nombre, accent_hex) VALUES
    (1, 'COL', NULL,       'Liga BetPlay',      '#e7c566'),
    (2, NULL,  'CONMEBOL', 'Copa Libertadores', '#3b82f6'),
    (3, 'ENG', NULL,       'Premier League',    '#a78bfa'),
    (4, 'ESP', NULL,       'LaLiga',            '#fb7185');

-- Una temporada vigente por torneo (1..4) y, en la Liga BetPlay, tambien la
-- anterior (5): asi "la temporada vigente = la ultima que empezo" (LATERAL en
-- 03_consultas.sql, ListarTorneos en el servicio) tiene algo que descartar.
INSERT INTO temporada (id_temporada, id_torneo, etiqueta, fecha_inicio, fecha_fin) VALUES
    (1, 1, @semestre_actual,   @hoy - INTERVAL 150 DAY, @hoy + INTERVAL  40 DAY),
    (2, 2, CONCAT(@anio, ''),  @hoy - INTERVAL 270 DAY, @hoy + INTERVAL  20 DAY),
    (3, 3, @temporada_europea, @hoy - INTERVAL  95 DAY, @hoy + INTERVAL 195 DAY),
    (4, 4, @temporada_europea, @hoy - INTERVAL  95 DAY, @hoy + INTERVAL 194 DAY),
    (5, 1, @semestre_anterior, @hoy - INTERVAL 330 DAY, @hoy - INTERVAL 160 DAY);

-- Dos jornadas por temporada vigente: la 1 ya se jugo (la semana pasada, con los
-- finalizados de -3 a -6 dias) y la 2 esta en curso (esta semana: desde ayer,
-- por si un partido en vivo empezo antes de la medianoche UTC, hasta +5 dias).
-- id_jornada = 2 * (id_temporada - 1) + numero.
INSERT INTO jornada (id_jornada, id_temporada, numero_jornada, fecha_inicio, fecha_fin) VALUES
    (1, 1, 1, @hoy - INTERVAL 8 DAY, @hoy - INTERVAL 2 DAY),
    (2, 1, 2, @hoy - INTERVAL 1 DAY, @hoy + INTERVAL 5 DAY),
    (3, 2, 1, @hoy - INTERVAL 8 DAY, @hoy - INTERVAL 2 DAY),
    (4, 2, 2, @hoy - INTERVAL 1 DAY, @hoy + INTERVAL 5 DAY),
    (5, 3, 1, @hoy - INTERVAL 8 DAY, @hoy - INTERVAL 2 DAY),
    (6, 3, 2, @hoy - INTERVAL 1 DAY, @hoy + INTERVAL 5 DAY),
    (7, 4, 1, @hoy - INTERVAL 8 DAY, @hoy - INTERVAL 2 DAY),
    (8, 4, 2, @hoy - INTERVAL 1 DAY, @hoy + INTERVAL 5 DAY);

-- ==============================================================================
-- 3. EQUIPOS Y COLORES  (orden fijo: MIL, NAL, AME, JUN, BOC, FLA, RIV, PAL,
--                        MCI, LIV, ARS, CHE, RMA, BAR, ATM, SEV)
-- ==============================================================================

INSERT INTO equipo (id_equipo, id_torneo, id_ciudad, nombre, codigo_corto, crest_seed, fundacion) VALUES
    -- Liga BetPlay
    ( 1, 1,  1, 'Millonarios',       'MIL', 0, '1946-06-18'),
    ( 2, 1,  2, 'Atlético Nacional', 'NAL', 1, '1947-03-07'),
    ( 3, 1,  3, 'América de Cali',   'AME', 2, '1927-02-13'),
    ( 4, 1,  4, 'Junior',            'JUN', 0, '1924-08-07'),
    -- Copa Libertadores
    ( 5, 2,  5, 'Boca Juniors',      'BOC', 1, '1905-04-03'),
    ( 6, 2,  6, 'Flamengo',          'FLA', 2, '1895-11-17'),
    ( 7, 2,  5, 'River Plate',       'RIV', 0, '1901-05-25'),
    ( 8, 2,  7, 'Palmeiras',         'PAL', 1, '1914-08-26'),
    -- Premier League
    ( 9, 3,  8, 'Manchester City',   'MCI', 2, '1880-04-16'),
    (10, 3,  9, 'Liverpool',         'LIV', 0, '1892-06-03'),
    (11, 3, 10, 'Arsenal',           'ARS', 1, '1886-12-01'),
    (12, 3, 10, 'Chelsea',           'CHE', 2, '1905-03-10'),
    -- LaLiga
    (13, 4, 11, 'Real Madrid',       'RMA', 1, '1902-03-06'),
    (14, 4, 12, 'Barcelona',         'BAR', 0, '1899-11-29'),
    (15, 4, 11, 'Atlético Madrid',   'ATM', 2, '1903-04-26'),
    (16, 4, 13, 'Sevilla',           'SEV', 1, '1890-01-25');

-- 4FN en accion: cada color es una FILA, no una columna.
INSERT INTO equipo_color (id_equipo, rol_color, valor_hex) VALUES
    ( 1, 'PRIMARY', '#123a8f'), ( 1, 'SECONDARY', '#ffffff'),
    ( 2, 'PRIMARY', '#0f8a3c'), ( 2, 'SECONDARY', '#f7e9b8'),
    ( 3, 'PRIMARY', '#c8102e'), ( 3, 'SECONDARY', '#ffffff'),
    ( 4, 'PRIMARY', '#e8d21c'), ( 4, 'SECONDARY', '#c8102e'),
    ( 5, 'PRIMARY', '#0b3a86'), ( 5, 'SECONDARY', '#f2c50a'),
    ( 6, 'PRIMARY', '#b8172c'), ( 6, 'SECONDARY', '#141414'),
    ( 7, 'PRIMARY', '#f4f6fb'), ( 7, 'SECONDARY', '#d1122f'),
    ( 8, 'PRIMARY', '#0d6b3f'), ( 8, 'SECONDARY', '#ffffff'),
    ( 9, 'PRIMARY', '#6cabdd'), ( 9, 'SECONDARY', '#1c2c5b'),
    (10, 'PRIMARY', '#c8102e'), (10, 'SECONDARY', '#f2c50a'),
    (11, 'PRIMARY', '#ef0107'), (11, 'SECONDARY', '#f4f6fb'),
    (12, 'PRIMARY', '#034694'), (12, 'SECONDARY', '#f2c50a'),
    (13, 'PRIMARY', '#f4f6fb'), (13, 'SECONDARY', '#0b3a86'),
    (14, 'PRIMARY', '#004d98'), (14, 'SECONDARY', '#a50044'),
    (15, 'PRIMARY', '#cb3524'), (15, 'SECONDARY', '#f4f6fb'),
    (16, 'PRIMARY', '#d4092a'), (16, 'SECONDARY', '#f4f6fb');

-- ==============================================================================
-- 4. JUGADORES
--  Plantilla de los cuatro equipos de la Liga BetPlay, los que tienen alineacion
--  y estadistica individual. Datos de demostracion: nombres inventados.
-- ==============================================================================

INSERT INTO jugador (id_jugador, id_equipo, codigo_pais_nac, nombres, apellidos, fecha_nacimiento, posicion, dorsal, activo) VALUES
    ( 1, 1, 'COL', 'Álvaro',   'Montaño',  '1995-04-12', 'PORTERO',        1, 1),
    ( 2, 1, 'COL', 'Diego',    'Restrepo', '1998-09-03', 'MEDIOCAMPISTA',  8, 1),
    ( 3, 1, 'COL', 'Santiago', 'Bermúdez', '2000-01-22', 'DELANTERO',      9, 1),
    ( 4, 2, 'COL', 'Kevin',    'Osorio',   '1994-11-30', 'PORTERO',       12, 1),
    ( 5, 2, 'COL', 'Mateo',    'Cardona',  '1997-06-15', 'DEFENSA',        4, 1),
    ( 6, 2, 'COL', 'Julián',   'Arboleda', '1999-03-08', 'DELANTERO',     11, 1),
    ( 7, 3, 'COL', 'Brayan',   'Solís',    '1996-02-19', 'PORTERO',        1, 1),
    ( 8, 3, 'COL', 'Nicolás',  'Vergara',  '1998-12-05', 'MEDIOCAMPISTA', 10, 1),
    ( 9, 3, 'COL', 'Emerson',  'Palacios', '2001-07-14', 'DELANTERO',      7, 1),
    (10, 4, 'COL', 'Óscar',    'Barrios',  '1993-08-27', 'PORTERO',        1, 1),
    (11, 4, 'COL', 'Andrés',   'Camacho',  '1996-05-11', 'DEFENSA',        3, 1),
    (12, 4, 'COL', 'Luis',     'Miranda',  '2000-10-02', 'DELANTERO',      9, 1);

-- ==============================================================================
-- 5. ENCUENTROS  (id 1..12 = m-01..m-12 del monolito)
--  Las cuotas NO van aqui: son de ms-apuestas (cuota_oferta.id_encuentro).
-- ==============================================================================

INSERT INTO encuentro (id_encuentro, id_jornada, id_estadio, estado, fecha_hora, minuto, arbitro, destacado) VALUES
    -- ------------------------------------------- EN VIVO: empezaron hace `minuto`
    ( 1, 2,  1, 'live',     @ahora - INTERVAL 67 MINUTE,                       67, 'Wilmar Roldán',   1),
    ( 2, 4,  5, 'live',     @ahora - INTERVAL 34 MINUTE,                       34, 'Néstor Pitana',   1),
    ( 3, 6,  9, 'live',     @ahora - INTERVAL 81 MINUTE,                       81, 'Michael Oliver',  1),
    ( 4, 8, 13, 'live',     @ahora - INTERVAL 52 MINUTE,                       52, 'Mateu Lahoz',     1),
    -- ------------------------------------------ PROXIMOS: +1..+4 dias (hora UTC)
    ( 5, 2,  3, 'upcoming', TIMESTAMP(@hoy + INTERVAL 1 DAY, '00:30:00'),    NULL, 'Andrés Rojas',    0),
    ( 6, 4,  6, 'upcoming', TIMESTAMP(@hoy + INTERVAL 2 DAY, '01:00:00'),    NULL, 'Raphael Claus',   0),
    ( 7, 6, 11, 'upcoming', TIMESTAMP(@hoy + INTERVAL 3 DAY, '16:30:00'),    NULL, 'Anthony Taylor',  0),
    ( 8, 8, 14, 'upcoming', TIMESTAMP(@hoy + INTERVAL 4 DAY, '19:15:00'),    NULL, 'Gil Manzano',     0),
    -- --------------------------------------------- FINALIZADOS: -3..-6 dias
    ( 9, 1,  2, 'finished', TIMESTAMP(@hoy - INTERVAL 3 DAY, '00:00:00'),    NULL, 'Carlos Betancur', 0),
    (10, 3,  7, 'finished', TIMESTAMP(@hoy - INTERVAL 4 DAY, '23:00:00'),    NULL, 'Wilton Sampaio',  0),
    (11, 5, 12, 'finished', TIMESTAMP(@hoy - INTERVAL 5 DAY, '18:45:00'),    NULL, 'Paul Tierney',    0),
    (12, 7, 15, 'finished', TIMESTAMP(@hoy - INTERVAL 6 DAY, '20:00:00'),    NULL, 'Munuera Montero', 0);

-- Cada encuentro son DOS filas: LOCAL y VISITANTE. El marcador es por equipo.
-- En los proximos los goles quedan NULL: todavia no hay marcador (no es 0-0).
INSERT INTO encuentro_equipo (id_encuentro, rol, id_equipo, goles) VALUES
    ( 1, 'LOCAL',  1,    1), ( 1, 'VISITANTE',  2,    0),   -- MIL 1-0 NAL
    ( 2, 'LOCAL',  5,    0), ( 2, 'VISITANTE',  6,    2),   -- BOC 0-2 FLA
    ( 3, 'LOCAL',  9,    2), ( 3, 'VISITANTE', 10,    2),   -- MCI 2-2 LIV
    ( 4, 'LOCAL', 13,    1), ( 4, 'VISITANTE', 14,    1),   -- RMA 1-1 BAR
    ( 5, 'LOCAL',  3, NULL), ( 5, 'VISITANTE',  4, NULL),   -- AME - JUN
    ( 6, 'LOCAL',  7, NULL), ( 6, 'VISITANTE',  8, NULL),   -- RIV - PAL
    ( 7, 'LOCAL', 11, NULL), ( 7, 'VISITANTE', 12, NULL),   -- ARS - CHE
    ( 8, 'LOCAL', 15, NULL), ( 8, 'VISITANTE', 16, NULL),   -- ATM - SEV
    ( 9, 'LOCAL',  2,    3), ( 9, 'VISITANTE',  3,    1),   -- NAL 3-1 AME
    (10, 'LOCAL',  8,    2), (10, 'VISITANTE',  5,    2),   -- PAL 2-2 BOC
    (11, 'LOCAL', 12,    0), (11, 'VISITANTE',  9,    4),   -- CHE 0-4 MCI
    (12, 'LOCAL', 14,    2), (12, 'VISITANTE', 15,    0);   -- BAR 2-0 ATM

-- ==============================================================================
-- 6. ALINEACIONES Y ESTADISTICAS
-- ==============================================================================

-- Alineacion de los dos partidos de Liga BetPlay que ya tienen resultado
-- (1 en vivo y 9 finalizado): los tres jugadores de cada equipo, titulares.
INSERT INTO alineacion (id_encuentro, id_jugador, es_titular, posicion_juego)
SELECT ee.id_encuentro, ju.id_jugador, 1, ju.posicion
FROM encuentro_equipo ee
JOIN jugador ju ON ju.id_equipo = ee.id_equipo
WHERE ee.id_encuentro IN (1, 9);

-- Estadistica de equipo de los 8 partidos que ya empezaron.
-- posesion_local + posesion_visitante = 100 lo exige CHK_EstEnc_PosesionSuma.
INSERT INTO estadistica_encuentro (
    id_encuentro, posesion_local, posesion_visitante,
    tiros_local, tiros_visitante, tiros_arco_local, tiros_arco_visitante,
    faltas_local, faltas_visitante, corners_local, corners_visitante) VALUES
    ( 1, 58.00, 42.00, 12,  7,  5,  2,  9, 13,  6,  3),
    ( 2, 46.50, 53.50,  8, 11,  3,  6, 14, 10,  4,  5),
    ( 3, 61.20, 38.80, 15, 10,  7,  4,  8, 11,  8,  4),
    ( 4, 52.00, 48.00, 11, 12,  4,  5, 12, 12,  5,  6),
    ( 9, 55.40, 44.60, 17,  6,  9,  2, 10, 16,  9,  2),
    (10, 49.00, 51.00, 13, 13,  6,  6, 15, 15,  6,  6),
    (11, 38.80, 61.20,  6, 21,  1, 11, 17,  7,  2, 11),
    (12, 64.30, 35.70, 19,  5, 10,  1,  7, 14, 10,  1);

-- Estadistica individual de los 12 jugadores alineados. Los goles cuadran con
-- el marcador: el 1 va 1-0 (Bermudez) y el 9 fue 3-1 (Arboleda 3, Palacios 1).
INSERT INTO estadistica_jugador_encuentro (
    id_encuentro, id_jugador, minutos_jugados, goles, asistencias, tiros,
    pases_completados, pases_intentados) VALUES
    (1, 1, 67, 0, 0, 0, 18, 22),   -- Montaño
    (1, 2, 67, 0, 1, 2, 41, 47),   -- Restrepo
    (1, 3, 67, 1, 0, 4, 12, 19),   -- Bermúdez
    (1, 4, 67, 0, 0, 0, 15, 21),   -- Osorio
    (1, 5, 67, 0, 0, 1, 33, 39),   -- Cardona
    (1, 6, 67, 0, 0, 3,  9, 16),   -- Arboleda
    (9, 4, 90, 0, 0, 0, 24, 28),   -- Osorio
    (9, 5, 90, 0, 1, 2, 52, 58),   -- Cardona
    (9, 6, 90, 3, 0, 6, 14, 21),   -- Arboleda
    (9, 7, 90, 0, 0, 0, 19, 27),   -- Solís
    (9, 8, 90, 0, 1, 1, 44, 51),   -- Vergara
    (9, 9, 90, 1, 0, 3, 11, 18);   -- Palacios

COMMIT;

-- ==============================================================================
-- VERIFICACION: cada tabla con su numero de filas (minimo 2 por el taller).
-- db/setup.js imprime este resultado y falla si alguna tabla no cumple.
-- ==============================================================================
SELECT v.tabla, v.filas, IF(v.filas >= 2, 'OK', 'FALTA') AS cumple
FROM (
              SELECT 'pais'                          AS tabla, COUNT(*) AS filas FROM pais
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
) v;
