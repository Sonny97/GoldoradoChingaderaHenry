-- ==============================================================================
--  GOLDORADO - ms-deportes
--  Motor: MySQL 8.0.16+ / 8.4 (InnoDB, utf8mb4)     Archivo 1 de 3: ESTRUCTURA
--
--  Las 15 tablas deportivas del monolito (SQL Server, server/db/01_esquema.sql)
--  pasadas a MySQL. Mismo modelo y las MISMAS restricciones con los MISMOS
--  nombres: un error de integridad se explica igual en los dos motores.
--
--  Lo que cambia de T-SQL a MySQL (cada caso va comentado donde ocurre):
--   - IDENTITY(1,1)     -> AUTO_INCREMENT. Insertar un id explicito no exige
--                          SET IDENTITY_INSERT: el contador sigue desde el mayor.
--   - NVARCHAR / N'...' -> VARCHAR en una base utf8mb4. En MySQL el juego de
--                          caracteres es de la base/columna, no del tipo.
--   - BIT               -> TINYINT(1) (lo que MySQL llama BOOLEAN). TINYINT admite
--                          -128..127, asi que un CHECK (x IN (0,1)) recupera la
--                          garantia que BIT daba gratis.
--   - DATETIME2         -> DATETIME guardado SIEMPRE en UTC (UTC_TIMESTAMP() en
--                          vez de SYSDATETIME()). No se usa TIMESTAMP: convierte
--                          segun la zona horaria de la sesion y se acaba en 2038.
--   - Indice unico FILTRADO -> UNIQUE normal (ver Jugador).
--   - DEFAULT con nombre (DF_) -> en MySQL DEFAULT es un atributo de la columna,
--                          no una restriccion, y no se puede nombrar. El nombre
--                          del monolito queda en el comentario de la columna.
--   - CONSTRAINT PK_x   -> MySQL acepta la sintaxis, pero la llave primaria se
--                          llama siempre PRIMARY. Se deja escrito para documentar.
--   - CHECK             -> MySQL los respeta desde 8.0.16; antes los analizaba y
--                          los ignoraba en silencio. Por eso la version minima.
--   - GO                -> no existe: cada sentencia termina en ';'.
--   - Nombres de tabla en minuscula snake_case: en Linux MySQL distingue
--     mayusculas en los nombres de tabla (son archivos) y en Windows no.
--
--  Las tablas de rompimiento siguen SIN llave primaria, como en el monolito.
--  InnoDB igual necesita un indice agrupado y usa el primer UNIQUE cuyas columnas
--  sean todas NOT NULL (p. ej. UQ_EncuentroEquipo_Rol). Si un servidor administrado
--  tiene sql_require_primary_key=ON, esas tablas no se crean (error 3750).
--
--  InnoDB exige un indice en cada columna con llave foranea y, si no lo hay, lo
--  inventa con el nombre de la FK. Por eso cada FK que no esta cubierta por un
--  UNIQUE lleva su indice IX_ declarado dentro del CREATE TABLE.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. CREACION DE LA BASE
-- ------------------------------------------------------------------------------
-- En SQL Server habia que expulsar sesiones (SINGLE_USER WITH ROLLBACK
-- IMMEDIATE) para poder borrar la base. MySQL no falla: el DROP espera los
-- bloqueos de metadatos de las otras sesiones. Si se queda "colgado", hay una
-- transaccion abierta en otra conexion (SHOW PROCESSLIST).
DROP DATABASE IF EXISTS goldorado_deportes;

-- utf8mb4 (no el "utf8" viejo de 3 bytes). utf8mb4_0900_ai_ci es insensible a
-- mayusculas y a tildes: 'Bogota' y 'Bogotá' chocan en un UNIQUE de nombre.
CREATE DATABASE goldorado_deportes
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;

USE goldorado_deportes;

-- ==============================================================================
-- 1. GEOGRAFIA   pais -> region -> ciudad -> estadio
-- ==============================================================================

-- Clave natural: el codigo ISO 3166-1 alfa-3 YA identifica al pais.
CREATE TABLE pais (
    codigo_iso CHAR(3)      NOT NULL,
    nombre     VARCHAR(100) NOT NULL,

    CONSTRAINT PK_Pais        PRIMARY KEY (codigo_iso),
    CONSTRAINT UQ_Pais_Nombre UNIQUE (nombre)
) ENGINE = InnoDB;

-- 3FN: la ciudad depende de una region que a su vez pertenece al pais.
CREATE TABLE region (
    id_region   INT          NOT NULL AUTO_INCREMENT,
    codigo_pais CHAR(3)      NOT NULL,
    nombre      VARCHAR(100) NOT NULL,

    CONSTRAINT PK_Region      PRIMARY KEY (id_region),
    CONSTRAINT FK_Region_Pais FOREIGN KEY (codigo_pais) REFERENCES pais (codigo_iso),
    CONSTRAINT UQ_Region      UNIQUE (codigo_pais, nombre)   -- tambien sirve de indice a la FK
) ENGINE = InnoDB;

CREATE TABLE ciudad (
    id_ciudad INT          NOT NULL AUTO_INCREMENT,
    id_region INT          NOT NULL,
    nombre    VARCHAR(100) NOT NULL,

    CONSTRAINT PK_Ciudad        PRIMARY KEY (id_ciudad),
    CONSTRAINT FK_Ciudad_Region FOREIGN KEY (id_region) REFERENCES region (id_region),
    CONSTRAINT UQ_Ciudad        UNIQUE (id_region, nombre)
) ENGINE = InnoDB;

CREATE TABLE estadio (
    id_estadio INT          NOT NULL AUTO_INCREMENT,
    id_ciudad  INT          NOT NULL,
    nombre     VARCHAR(150) NOT NULL,
    capacidad  INT          NULL,

    CONSTRAINT PK_Estadio            PRIMARY KEY (id_estadio),
    CONSTRAINT FK_Estadio_Ciudad     FOREIGN KEY (id_ciudad) REFERENCES ciudad (id_ciudad),
    CONSTRAINT UQ_Estadio_Nombre     UNIQUE (nombre),
    CONSTRAINT CHK_Estadio_Capacidad CHECK (capacidad IS NULL OR capacidad > 0),
    INDEX IX_Estadio_Ciudad (id_ciudad)
) ENGINE = InnoDB;

-- ==============================================================================
-- 2. JERARQUIA DEPORTIVA   torneo -> temporada, mas equipos y jugadores
-- ==============================================================================

-- codigo_pais es NULLABLE a proposito: la Copa Libertadores es continental. El
-- CHECK de ambito obliga a que un torneo tenga pais O confederacion, nunca ambos
-- ni ninguno. En MySQL "x IS NULL" vale 0 o 1, asi que el <> entre los dos
-- resultados es el mismo XOR del monolito, escrito igual.
CREATE TABLE torneo (
    id_torneo     INT          NOT NULL AUTO_INCREMENT,
    codigo_pais   CHAR(3)      NULL,
    confederacion VARCHAR(40)  NULL,
    nombre        VARCHAR(150) NOT NULL,
    accent_hex    CHAR(7)      NULL,

    CONSTRAINT PK_Torneo         PRIMARY KEY (id_torneo),
    CONSTRAINT FK_Torneo_Pais    FOREIGN KEY (codigo_pais) REFERENCES pais (codigo_iso),
    CONSTRAINT UQ_Torneo         UNIQUE (nombre),
    CONSTRAINT CHK_Torneo_Ambito CHECK ((codigo_pais IS NULL) <> (confederacion IS NULL)),
    INDEX IX_Torneo_Pais (codigo_pais)
) ENGINE = InnoDB;

CREATE TABLE temporada (
    id_temporada INT         NOT NULL AUTO_INCREMENT,
    id_torneo    INT         NOT NULL,
    etiqueta     VARCHAR(50) NOT NULL,
    fecha_inicio DATE        NOT NULL,
    fecha_fin    DATE        NOT NULL,

    CONSTRAINT PK_Temporada         PRIMARY KEY (id_temporada),
    CONSTRAINT FK_Temporada_Torneo  FOREIGN KEY (id_torneo) REFERENCES torneo (id_torneo),
    CONSTRAINT UQ_Temporada         UNIQUE (id_torneo, etiqueta),
    CONSTRAINT CHK_Temporada_Fechas CHECK (fecha_fin >= fecha_inicio)
) ENGINE = InnoDB;

-- LIMITACION CONOCIDA (heredada): id_torneo obliga a que un equipo juegue un
-- solo torneo. Lo correcto seria una tabla de rompimiento equipo_torneo.
CREATE TABLE equipo (
    id_equipo    INT          NOT NULL AUTO_INCREMENT,
    id_torneo    INT          NOT NULL,
    id_ciudad    INT          NOT NULL,
    nombre       VARCHAR(150) NOT NULL,
    codigo_corto CHAR(3)      NOT NULL,             -- 'MIL','NAL': lo que dibuja el escudo
    crest_seed   TINYINT      NOT NULL DEFAULT 0,   -- DF_Equipo_CrestSeed · 0|1|2 patron del escudo
    fundacion    DATE         NULL,

    CONSTRAINT PK_Equipo             PRIMARY KEY (id_equipo),
    CONSTRAINT FK_Equipo_Torneo      FOREIGN KEY (id_torneo) REFERENCES torneo (id_torneo),
    CONSTRAINT FK_Equipo_Ciudad      FOREIGN KEY (id_ciudad) REFERENCES ciudad (id_ciudad),
    CONSTRAINT UQ_Equipo_Nombre      UNIQUE (nombre, id_torneo),
    CONSTRAINT UQ_Equipo_CodigoCorto UNIQUE (id_torneo, codigo_corto),
    CONSTRAINT CHK_Equipo_CrestSeed  CHECK (crest_seed BETWEEN 0 AND 2),
    INDEX IX_Equipo_Ciudad (id_ciudad)
) ENGINE = InnoDB;

-- 4FN: un equipo tiene VARIOS colores. Tabla de rompimiento sin PRIMARY KEY.
CREATE TABLE equipo_color (
    id_equipo INT         NOT NULL,
    rol_color VARCHAR(10) NOT NULL,   -- 'PRIMARY' | 'SECONDARY'
    valor_hex CHAR(7)     NOT NULL,

    CONSTRAINT FK_EquipoColor_Equipo FOREIGN KEY (id_equipo) REFERENCES equipo (id_equipo),
    CONSTRAINT UQ_EquipoColor        UNIQUE (id_equipo, rol_color),
    CONSTRAINT CHK_EquipoColor_Rol   CHECK (rol_color IN ('PRIMARY','SECONDARY'))
) ENGINE = InnoDB;

-- Jugador es una ENTIDAD propia: alineaciones y estadisticas lo referencian.
CREATE TABLE jugador (
    id_jugador       INT          NOT NULL AUTO_INCREMENT,
    id_equipo        INT          NOT NULL,
    codigo_pais_nac  CHAR(3)      NULL,
    nombres          VARCHAR(100) NOT NULL,
    apellidos        VARCHAR(100) NOT NULL,
    fecha_nacimiento DATE         NOT NULL,
    posicion         VARCHAR(30)  NOT NULL,
    dorsal           INT          NULL,
    activo           TINYINT(1)   NOT NULL DEFAULT 1,   -- DF_Jugador_Activo

    CONSTRAINT PK_Jugador           PRIMARY KEY (id_jugador),
    CONSTRAINT FK_Jugador_Equipo    FOREIGN KEY (id_equipo)       REFERENCES equipo (id_equipo),
    CONSTRAINT FK_Jugador_Pais      FOREIGN KEY (codigo_pais_nac) REFERENCES pais (codigo_iso),
    CONSTRAINT CHK_Jugador_Dorsal   CHECK (dorsal IS NULL OR dorsal > 0),
    CONSTRAINT CHK_Jugador_Posicion CHECK (posicion IN ('PORTERO','DEFENSA','MEDIOCAMPISTA','DELANTERO')),
    CONSTRAINT CHK_Jugador_Activo   CHECK (activo IN (0, 1)),
    -- El dorsal es unico dentro del equipo, PERO puede no estar asignado.
    -- SQL Server trata dos NULL como iguales en un UNIQUE, y por eso el monolito
    -- necesito un indice unico FILTRADO (WHERE dorsal IS NOT NULL). MySQL no
    -- tiene indices filtrados ni le hacen falta: un indice unico admite varios
    -- NULL (como dice el estandar), asi que un UNIQUE normal dice exactamente lo
    -- mismo. Demostracion en 03_consultas.sql, seccion 9.1.
    CONSTRAINT UQ_Jugador_Dorsal    UNIQUE (id_equipo, dorsal),
    INDEX IX_Jugador_Pais (codigo_pais_nac)
) ENGINE = InnoDB;

-- ==============================================================================
-- 3. CALENDARIO Y ENCUENTROS   jornada -> encuentro -> participacion
-- ==============================================================================

CREATE TABLE jornada (
    id_jornada     INT  NOT NULL AUTO_INCREMENT,
    id_temporada   INT  NOT NULL,
    numero_jornada INT  NOT NULL,
    fecha_inicio   DATE NOT NULL,
    fecha_fin      DATE NOT NULL,

    CONSTRAINT PK_Jornada           PRIMARY KEY (id_jornada),
    CONSTRAINT FK_Jornada_Temporada FOREIGN KEY (id_temporada) REFERENCES temporada (id_temporada),
    CONSTRAINT UQ_Jornada           UNIQUE (id_temporada, numero_jornada),
    CONSTRAINT CHK_Jornada_Fechas   CHECK (fecha_fin >= fecha_inicio),
    CONSTRAINT CHK_Jornada_Numero   CHECK (numero_jornada > 0)
) ENGINE = InnoDB;

-- fecha_hora es DATETIME en UTC: MySQL no guarda zona horaria en DATETIME, la
-- convencion la pone la aplicacion (el pool de mysql2 usa timezone 'Z').
CREATE TABLE encuentro (
    id_encuentro BIGINT       NOT NULL AUTO_INCREMENT,
    id_jornada   INT          NOT NULL,
    id_estadio   INT          NULL,
    estado       VARCHAR(15)  NOT NULL DEFAULT 'upcoming',   -- DF_Encuentro_Estado
    fecha_hora   DATETIME     NOT NULL,                      -- kickoff (UTC)
    minuto       INT          NULL,                          -- solo tiene sentido si estado='live'
    arbitro      VARCHAR(150) NULL,
    destacado    TINYINT(1)   NOT NULL DEFAULT 0,            -- DF_Encuentro_Destacado

    CONSTRAINT PK_Encuentro            PRIMARY KEY (id_encuentro),
    CONSTRAINT FK_Encuentro_Jornada    FOREIGN KEY (id_jornada) REFERENCES jornada (id_jornada),
    CONSTRAINT FK_Encuentro_Estadio    FOREIGN KEY (id_estadio) REFERENCES estadio (id_estadio),
    CONSTRAINT CHK_Encuentro_Estado    CHECK (estado IN ('live','upcoming','finished','canceled')),
    CONSTRAINT CHK_Encuentro_Minuto    CHECK (minuto IS NULL OR minuto BETWEEN 0 AND 130),
    CONSTRAINT CHK_Encuentro_Destacado CHECK (destacado IN (0, 1)),
    -- IX_Encuentro_Jornada estaba en la seccion 10 del monolito; aqui va dentro
    -- del CREATE TABLE para que InnoDB no invente otro indice para la FK.
    INDEX IX_Encuentro_Jornada (id_jornada),
    INDEX IX_Encuentro_Estadio (id_estadio)
) ENGINE = InnoDB;

-- Resuelve "cual de los dos id_equipo se une a equipo": AMBOS. Cada encuentro
-- son 2 filas (LOCAL y VISITANTE) que apuntan a la MISMA tabla equipo con roles
-- distintos. El marcador es por equipo. Tabla de rompimiento sin PRIMARY KEY.
--
-- goles es NULL, no 0: un partido que aun no se juega no va 0-0, simplemente no
-- tiene marcador. Es la diferencia entre "cero goles" y "todavia no se sabe".
CREATE TABLE encuentro_equipo (
    id_encuentro BIGINT      NOT NULL,
    rol          VARCHAR(10) NOT NULL,   -- 'LOCAL' | 'VISITANTE'
    id_equipo    INT         NOT NULL,
    goles        INT         NULL,

    CONSTRAINT FK_EncuentroEquipo_Encuentro FOREIGN KEY (id_encuentro) REFERENCES encuentro (id_encuentro),
    CONSTRAINT FK_EncuentroEquipo_Equipo    FOREIGN KEY (id_equipo)    REFERENCES equipo (id_equipo),
    CONSTRAINT CHK_EncuentroEquipo_Rol      CHECK (rol IN ('LOCAL','VISITANTE')),
    CONSTRAINT CHK_EncuentroEquipo_Goles    CHECK (goles IS NULL OR goles >= 0),
    -- Un encuentro tiene exactamente un local y un visitante...
    CONSTRAINT UQ_EncuentroEquipo_Rol       UNIQUE (id_encuentro, rol),
    -- ...y ningun equipo puede enfrentarse a si mismo.
    CONSTRAINT UQ_EncuentroEquipo_Equipo    UNIQUE (id_encuentro, id_equipo),
    -- "Partidos de un equipo" (filtro idEquipo) entra por aqui.
    INDEX IX_EncuentroEquipo_Equipo (id_equipo)
) ENGINE = InnoDB;

-- Tabla de rompimiento jugador <-> encuentro. Sin PRIMARY KEY.
CREATE TABLE alineacion (
    id_encuentro   BIGINT      NOT NULL,
    id_jugador     INT         NOT NULL,
    es_titular     TINYINT(1)  NOT NULL DEFAULT 1,   -- DF_Alineacion_Titular
    posicion_juego VARCHAR(30) NULL,

    CONSTRAINT FK_Alineacion_Encuentro FOREIGN KEY (id_encuentro) REFERENCES encuentro (id_encuentro),
    CONSTRAINT FK_Alineacion_Jugador   FOREIGN KEY (id_jugador)   REFERENCES jugador (id_jugador),
    CONSTRAINT UQ_Alineacion           UNIQUE (id_encuentro, id_jugador),
    CONSTRAINT CHK_Alineacion_Titular  CHECK (es_titular IN (0, 1)),
    INDEX IX_Alineacion_Jugador (id_jugador)
) ENGINE = InnoDB;

-- ==============================================================================
-- 4. ESTADISTICAS
-- ==============================================================================

-- 1 a 1 con encuentro: la PK ES el propio id_encuentro (primary-to-primary),
-- sin AUTO_INCREMENT porque no puede haber dos estadisticas del mismo partido.
-- LIMITACION CONOCIDA (heredada): _local/_visitante es un grupo repetitivo por
-- rol; lo coherente seria estadistica_encuentro_equipo.
CREATE TABLE estadistica_encuentro (
    id_encuentro         BIGINT       NOT NULL,
    posesion_local       DECIMAL(5,2) NULL,
    posesion_visitante   DECIMAL(5,2) NULL,
    tiros_local          INT          NULL,
    tiros_visitante      INT          NULL,
    tiros_arco_local     INT          NULL,
    tiros_arco_visitante INT          NULL,
    faltas_local         INT          NULL,
    faltas_visitante     INT          NULL,
    corners_local        INT          NULL,
    corners_visitante    INT          NULL,

    CONSTRAINT PK_EstadisticaEncuentro      PRIMARY KEY (id_encuentro),
    CONSTRAINT FK_EstadisticaEncuentro_Enc  FOREIGN KEY (id_encuentro) REFERENCES encuentro (id_encuentro),
    CONSTRAINT CHK_EstEnc_PosesionLocal     CHECK (posesion_local     IS NULL OR posesion_local     BETWEEN 0 AND 100),
    CONSTRAINT CHK_EstEnc_PosesionVisitante CHECK (posesion_visitante IS NULL OR posesion_visitante BETWEEN 0 AND 100),
    -- La posesion de los dos equipos tiene que sumar 100: 60/70 es imposible.
    CONSTRAINT CHK_EstEnc_PosesionSuma      CHECK (
        posesion_local IS NULL OR posesion_visitante IS NULL
        OR posesion_local + posesion_visitante = 100
    )
) ENGINE = InnoDB;

-- Estadistica por jugador y partido. Tabla de rompimiento sin PRIMARY KEY.
CREATE TABLE estadistica_jugador_encuentro (
    id_encuentro      BIGINT NOT NULL,
    id_jugador        INT    NOT NULL,
    minutos_jugados   INT    NULL,
    goles             INT    NOT NULL DEFAULT 0,   -- DF_EstJugador_Goles
    asistencias       INT    NOT NULL DEFAULT 0,   -- DF_EstJugador_Asistencias
    tiros             INT    NOT NULL DEFAULT 0,   -- DF_EstJugador_Tiros
    pases_completados INT    NULL,
    pases_intentados  INT    NULL,

    CONSTRAINT FK_EstJugador_Encuentro FOREIGN KEY (id_encuentro) REFERENCES encuentro (id_encuentro),
    CONSTRAINT FK_EstJugador_Jugador   FOREIGN KEY (id_jugador)   REFERENCES jugador (id_jugador),
    CONSTRAINT UQ_EstJugador           UNIQUE (id_encuentro, id_jugador),
    -- No se pueden completar mas pases de los que se intentaron.
    CONSTRAINT CHK_EstJugador_Pases    CHECK (
        pases_completados IS NULL OR pases_intentados IS NULL
        OR pases_completados <= pases_intentados
    ),
    INDEX IX_EstJugador_Jugador (id_jugador)
) ENGINE = InnoDB;

-- ==============================================================================
-- 10. INDICES ESTRATEGICOS (los del monolito que son de este dominio)
--
--  Las PK y los UNIQUE ya crean su propio indice; los IX_ de llaves foraneas van
--  dentro de cada CREATE TABLE. Estos cubren las consultas que hace el servicio
--  (src/repositorios/).
-- ==============================================================================

-- La home ordena por estado y fecha de inicio.
CREATE INDEX IX_Encuentro_Fecha ON encuentro (fecha_hora);

-- En SQL Server este indice hacia falta porque UQ_Jugador_Dorsal era FILTRADO y
-- no cubria a los jugadores sin dorsal. En MySQL UQ_Jugador_Dorsal ya empieza por
-- id_equipo y tiene todas las filas, asi que este queda redundante; se conserva
-- para que los dos esquemas tengan los mismos nombres.
CREATE INDEX IX_Jugador_Equipo ON jugador (id_equipo);
