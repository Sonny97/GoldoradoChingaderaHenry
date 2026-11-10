-- =============================================================================
--  goldorado_apuestas · ESQUEMA · PostgreSQL 14+ (probado en 16-18)
--  Produccion: Azure Database for PostgreSQL - Flexible Server
--
--  El "API" del negocio: mercados, cuotas, reglas de monto, apuestas, la
--  billetera de cada cliente con su diario, promociones y la bandeja de salida
--  (outbox) hacia el libro contable de MongoDB.
--
--  Viene de las secciones 6-8 y 10 de server/db/01_esquema.sql del monolito
--  (SQL Server). Equivalencias que conviene saber explicar:
--    IDENTITY(1,1)                -> GENERATED ALWAYS AS IDENTITY
--    DATETIME2 / SYSDATETIME()    -> TIMESTAMPTZ / now()   (siempre con zona)
--    DECIMAL(18,2)                -> NUMERIC(18,2)
--    columna calculada PERSISTED  -> GENERATED ALWAYS AS (...) STORED
--    NVARCHAR                     -> VARCHAR (la base es UTF8: no hace falta la N)
--    BIT                          -> BOOLEAN
--    CONSTRAINT DF_... DEFAULT    -> DEFAULT a secas: en PostgreSQL un DEFAULT
--                                    no es una restriccion y no lleva nombre.
--
--  Nombres de restricciones: PostgreSQL pasa a minuscula todo identificador sin
--  comillas, asi que PK_CuentaSaldo se escribe pk_cuenta_saldo (es el nombre
--  que se ve en pg_constraint y en los mensajes de error). Prefijos: pk_, fk_,
--  uq_, chk_, ix_.
--
--  Referencias EXTERNAS (ids de otras bases, sin FK posible entre motores):
--    cuenta_saldo.id_usuario / apuesta.id_usuario -> Usuario (SQL Server, ms-autenticacion)
--    cuota_oferta.id_encuentro                    -> encuentro (MySQL, ms-deportes)
--    promocion_torneo.id_torneo                   -> torneo (MySQL, ms-deportes)
--    apuesta.id_transaccion (UUID)                -> transacciones.codigo (MongoDB)
--
--  Re-ejecutable: borra y vuelve a crear SOLO las tablas del proyecto, sin
--  DROP DATABASE (en Azure el usuario de la aplicacion no siempre puede).
--  Uso: psql -h <host> -U <usuario> -d goldorado_apuestas -f db/01_esquema.sql
--       (o npm run db:setup, que tambien carga los datos)
-- =============================================================================

DROP TABLE IF EXISTS
    evento_salida,
    promocion_torneo,
    promocion,
    movimiento_saldo,
    apuesta,
    cuenta_saldo,
    cuota_oferta,
    regla_apuesta,
    opcion_mercado,
    tipo_mercado
CASCADE;

-- =============================================================================
-- 1. MERCADOS Y REGLAS   (Goldorado como unico operador)
-- =============================================================================

-- Llave natural: el codigo ('1X2') es lo que viaja en el contrato gRPC.
CREATE TABLE tipo_mercado (
    codigo      VARCHAR(30)  NOT NULL,   -- '1X2' | 'AMBOS_ANOTAN' | 'OVER_UNDER'
    nombre      VARCHAR(80)  NOT NULL,
    descripcion VARCHAR(255),

    CONSTRAINT pk_tipo_mercado        PRIMARY KEY (codigo),
    CONSTRAINT uq_tipo_mercado_nombre UNIQUE (nombre),
    CONSTRAINT chk_tipo_mercado_codigo CHECK (codigo = upper(codigo))
);

-- 3FN: las selecciones son catalogo del tipo de mercado, no texto libre dentro
-- de la cuota. codigo_corto es lo que se pinta en el chip: 1 / X / 2 / GG.
CREATE TABLE opcion_mercado (
    id_opcion      INTEGER     GENERATED ALWAYS AS IDENTITY,
    codigo_mercado VARCHAR(30) NOT NULL,
    codigo_corto   VARCHAR(5)  NOT NULL,
    seleccion      VARCHAR(50) NOT NULL,   -- 'Local', 'Empate', 'Más de 2.5'
    orden          SMALLINT    NOT NULL,   -- posicion del chip en la franja

    CONSTRAINT pk_opcion_mercado        PRIMARY KEY (id_opcion),
    CONSTRAINT fk_opcion_mercado_tipo   FOREIGN KEY (codigo_mercado) REFERENCES tipo_mercado (codigo),
    CONSTRAINT uq_opcion_mercado        UNIQUE (codigo_mercado, seleccion),
    CONSTRAINT uq_opcion_mercado_corto  UNIQUE (codigo_mercado, codigo_corto),
    CONSTRAINT chk_opcion_mercado_orden CHECK (orden > 0)
);

-- La REGLA (limites de monto) por tipo de mercado. La APUESTA la referencia
-- porque la regla condiciona el ACTO de apostar, no el mercado en si.
CREATE TABLE regla_apuesta (
    id_regla       INTEGER       GENERATED ALWAYS AS IDENTITY,
    codigo_mercado VARCHAR(30)   NOT NULL,
    nombre         VARCHAR(100)  NOT NULL,
    monto_minimo   NUMERIC(18,2) NOT NULL,
    monto_maximo   NUMERIC(18,2) NOT NULL,
    descripcion    VARCHAR(255),

    CONSTRAINT pk_regla_apuesta        PRIMARY KEY (id_regla),
    CONSTRAINT fk_regla_apuesta_tipo   FOREIGN KEY (codigo_mercado) REFERENCES tipo_mercado (codigo),
    CONSTRAINT uq_regla_apuesta        UNIQUE (codigo_mercado, nombre),
    CONSTRAINT chk_regla_apuesta_min   CHECK (monto_minimo >= 0),
    CONSTRAINT chk_regla_apuesta_max   CHECK (monto_maximo > 0),
    CONSTRAINT chk_regla_apuesta_rango CHECK (monto_maximo >= monto_minimo)
);

-- =============================================================================
-- 2. CUOTAS
-- =============================================================================

-- La cuota que Goldorado ofrece para un encuentro y una opcion de mercado.
-- id_encuentro es una referencia EXTERNA (MySQL): no puede haber FK, por eso
-- el CHECK de positivo y la validacion del estado del partido via gRPC.
--
-- Formato decimal europeo (2.00 = duplica lo apostado) y no fraccion en texto:
-- una fraccion en texto no se puede multiplicar, y apuesta.ganancia_potencial
-- es una columna generada monto * cuota.
CREATE TABLE cuota_oferta (
    id_cuota            BIGINT        GENERATED ALWAYS AS IDENTITY,
    id_encuentro        BIGINT        NOT NULL,
    id_opcion           INTEGER       NOT NULL,
    valor_cuota         NUMERIC(10,2) NOT NULL,
    estado              VARCHAR(20)   NOT NULL DEFAULT 'ABIERTO',
    fecha_actualizacion TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_cuota_oferta           PRIMARY KEY (id_cuota),
    CONSTRAINT fk_cuota_oferta_opcion    FOREIGN KEY (id_opcion) REFERENCES opcion_mercado (id_opcion),
    -- Goldorado ofrece UNA sola cuota por opcion y encuentro. Su indice
    -- (id_encuentro primero) sirve tambien a "WHERE id_encuentro = ANY(...)",
    -- asi que no hace falta el IX_Cuota_Encuentro del monolito.
    CONSTRAINT uq_cuota_oferta           UNIQUE (id_encuentro, id_opcion),
    CONSTRAINT chk_cuota_oferta_estado   CHECK (estado IN ('ABIERTO', 'SUSPENDIDO', 'CERRADO')),
    -- Una cuota de 1.00 devolveria exactamente lo apostado: no es una apuesta.
    CONSTRAINT chk_cuota_oferta_valor    CHECK (valor_cuota > 1),
    CONSTRAINT chk_cuota_oferta_encuentro CHECK (id_encuentro > 0)
);

-- =============================================================================
-- 3. BILLETERA
-- =============================================================================

-- 1 a 1 con el usuario de ms-autenticacion: PK = id_usuario (referencia externa).
-- saldo_bloqueado es el dinero comprometido en apuestas pendientes: sigue
-- siendo del cliente pero no se puede retirar ni volver a apostar.
-- Los CHECK >= 0 son la ultima linea de defensa: aunque una consulta olvidara
-- la condicion del saldo, la base no deja que quede negativo.
CREATE TABLE cuenta_saldo (
    id_usuario       BIGINT        NOT NULL,
    saldo_disponible NUMERIC(18,2) NOT NULL DEFAULT 0,
    saldo_bloqueado  NUMERIC(18,2) NOT NULL DEFAULT 0,
    moneda           CHAR(3)       NOT NULL DEFAULT 'COP',
    creado_en        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    actualizado_en   TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_cuenta_saldo             PRIMARY KEY (id_usuario),
    CONSTRAINT chk_cuenta_saldo_usuario    CHECK (id_usuario > 0),
    CONSTRAINT chk_cuenta_saldo_disponible CHECK (saldo_disponible >= 0),
    CONSTRAINT chk_cuenta_saldo_bloqueado  CHECK (saldo_bloqueado >= 0),
    -- Codigo ISO 4217 (COP). Hoy es la unica, pero el formato queda garantizado.
    CONSTRAINT chk_cuenta_saldo_moneda     CHECK (moneda ~ '^[A-Z]{3}$')
);

-- =============================================================================
-- 4. APUESTAS
-- =============================================================================

-- cuota_fijada es un SNAPSHOT deliberado, no una redundancia: la cuota del
-- encuentro cambia minuto a minuto, pero la apuesta se liquida con el valor que
-- estaba vigente en el instante en que el cliente la hizo. Si se leyera con un
-- JOIN a cuota_oferta, mover la cuota cambiaria apuestas ya hechas.
--
-- ganancia_potencial es GENERATED ... STORED (el PERSISTED de SQL Server): la
-- calcula y guarda el motor; nadie puede escribirla (SQLSTATE 428C9).
-- id_transaccion es el UUID del movimiento en MongoDB (transacciones.codigo):
-- lo genera ms-apuestas antes de insertar, asi el libro contable puede llegar
-- despues (bandeja de salida) sin perder el enlace.
CREATE TABLE apuesta (
    id_apuesta         BIGINT        GENERATED ALWAYS AS IDENTITY,
    id_usuario         BIGINT        NOT NULL,
    id_cuota           BIGINT        NOT NULL,
    id_regla           INTEGER       NOT NULL,
    id_transaccion     UUID          NOT NULL,
    estado_apuesta     VARCHAR(20)   NOT NULL DEFAULT 'PENDIENTE',
    monto_apostado     NUMERIC(18,2) NOT NULL,
    cuota_fijada       NUMERIC(10,2) NOT NULL,
    ganancia_potencial NUMERIC(18,2) GENERATED ALWAYS AS (round(monto_apostado * cuota_fijada, 2)) STORED,
    fecha_apuesta      TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_apuesta             PRIMARY KEY (id_apuesta),
    CONSTRAINT fk_apuesta_cuenta      FOREIGN KEY (id_usuario) REFERENCES cuenta_saldo (id_usuario),
    CONSTRAINT fk_apuesta_cuota       FOREIGN KEY (id_cuota)   REFERENCES cuota_oferta (id_cuota),
    CONSTRAINT fk_apuesta_regla       FOREIGN KEY (id_regla)   REFERENCES regla_apuesta (id_regla),
    CONSTRAINT uq_apuesta_transaccion UNIQUE (id_transaccion),
    CONSTRAINT chk_apuesta_estado     CHECK (estado_apuesta IN ('PENDIENTE', 'GANADA', 'PERDIDA', 'ANULADA')),
    CONSTRAINT chk_apuesta_monto      CHECK (monto_apostado > 0),
    CONSTRAINT chk_apuesta_cuota      CHECK (cuota_fijada > 1)
);

-- Diario de la billetera: cada peso que entra o sale queda con su saldo
-- resultante. referencia es la CLAVE DE IDEMPOTENCIA: la referencia del pago
-- (GD-...) en un deposito o el UUID de la transaccion en una apuesta. Un
-- reintento del webhook de Wompi choca contra el UNIQUE y no duplica dinero.
CREATE TABLE movimiento_saldo (
    id_movimiento               BIGINT        GENERATED ALWAYS AS IDENTITY,
    id_usuario                  BIGINT        NOT NULL,
    tipo                        VARCHAR(20)   NOT NULL,
    monto                       NUMERIC(18,2) NOT NULL,
    saldo_disponible_resultante NUMERIC(18,2) NOT NULL,
    referencia                  VARCHAR(100)  NOT NULL,
    proveedor                   VARCHAR(50),             -- 'Wompi' (NULL en movimientos internos)
    metodo                      VARCHAR(50),             -- 'PSE' | 'NEQUI' | 'CARD' ...
    id_transaccion_pasarela     VARCHAR(100),            -- id de la transaccion en Wompi
    creado_en                   TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT pk_movimiento_saldo             PRIMARY KEY (id_movimiento),
    CONSTRAINT fk_movimiento_saldo_cuenta      FOREIGN KEY (id_usuario) REFERENCES cuenta_saldo (id_usuario),
    CONSTRAINT uq_movimiento_saldo_referencia  UNIQUE (referencia),
    CONSTRAINT chk_movimiento_saldo_tipo       CHECK (tipo IN ('DEPOSITO', 'APUESTA', 'PREMIO', 'REEMBOLSO', 'RETIRO')),
    -- El signo lo da el tipo, no el monto: un movimiento de 0 o negativo no existe.
    CONSTRAINT chk_movimiento_saldo_monto      CHECK (monto > 0),
    CONSTRAINT chk_movimiento_saldo_resultante CHECK (saldo_disponible_resultante >= 0)
);

-- =============================================================================
-- 5. PROMOCIONES
-- =============================================================================

CREATE TABLE promocion (
    id_promocion INTEGER      GENERATED ALWAYS AS IDENTITY,
    titulo       VARCHAR(120) NOT NULL,
    subtitulo    VARCHAR(150),
    descripcion  VARCHAR(500),
    badge        VARCHAR(40),
    cta_label    VARCHAR(40),
    accent       VARCHAR(20),
    destacada    BOOLEAN      NOT NULL DEFAULT false,
    fecha_expira DATE         NOT NULL,

    CONSTRAINT pk_promocion         PRIMARY KEY (id_promocion),
    CONSTRAINT uq_promocion_titulo  UNIQUE (titulo),
    CONSTRAINT chk_promocion_accent CHECK (accent IS NULL OR accent IN ('gold', 'emerald', 'violet', 'crimson'))
);

-- N a N: una promo aplica a varios torneos y un torneo tiene varias promos.
-- Tabla de rompimiento, como en el monolito: sin PRIMARY KEY, con UNIQUE.
-- id_torneo es referencia EXTERNA (MySQL): solo la FK hacia promocion es posible.
CREATE TABLE promocion_torneo (
    id_promocion INTEGER NOT NULL,
    id_torneo    INTEGER NOT NULL,

    CONSTRAINT fk_promocion_torneo_promocion FOREIGN KEY (id_promocion) REFERENCES promocion (id_promocion),
    CONSTRAINT uq_promocion_torneo           UNIQUE (id_promocion, id_torneo),
    CONSTRAINT chk_promocion_torneo_torneo   CHECK (id_torneo > 0)
);

-- =============================================================================
-- 6. BANDEJA DE SALIDA (OUTBOX)
-- =============================================================================

-- Eventos para ms-transacciones (MongoDB) escritos en la MISMA transaccion que
-- la apuesta. Un proceso de fondo los toma con FOR UPDATE SKIP LOCKED, los
-- envia y llena enviado_en. carga es el RegistrarTransaccionRequest en JSONB:
-- se puede consultar por dentro (carga->>'codigo') sin otra tabla.
CREATE TABLE evento_salida (
    id_evento    BIGINT       GENERATED ALWAYS AS IDENTITY,
    tipo         VARCHAR(40)  NOT NULL,
    carga        JSONB        NOT NULL,
    creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    enviado_en   TIMESTAMPTZ,                       -- NULL = pendiente
    intentos     INTEGER      NOT NULL DEFAULT 0,
    ultimo_error VARCHAR(500),

    CONSTRAINT pk_evento_salida           PRIMARY KEY (id_evento),
    CONSTRAINT chk_evento_salida_tipo     CHECK (tipo IN ('TRANSACCION')),
    CONSTRAINT chk_evento_salida_carga    CHECK (jsonb_typeof(carga) = 'object'),
    CONSTRAINT chk_evento_salida_intentos CHECK (intentos >= 0),
    CONSTRAINT chk_evento_salida_envio    CHECK (enviado_en IS NULL OR enviado_en >= creado_en)
);

-- =============================================================================
-- 7. INDICES ESTRATEGICOS
--
--  Las PK y los UNIQUE ya crean su propio indice. Estos cubren las consultas
--  que la aplicacion hace de verdad (src/repositorios/).
-- =============================================================================

-- Historial del cliente (WHERE id_usuario ORDER BY fecha DESC). INCLUDE, como
-- en el monolito, lo vuelve un indice cubierto para el estado.
CREATE INDEX ix_apuesta_usuario ON apuesta (id_usuario, fecha_apuesta DESC) INCLUDE (estado_apuesta);
CREATE INDEX ix_apuesta_cuota   ON apuesta (id_cuota);

-- Estado de cuenta: los movimientos de un cliente en orden.
CREATE INDEX ix_movimiento_saldo_usuario ON movimiento_saldo (id_usuario, creado_en);

-- Vigencia de promociones (WHERE fecha_expira >= CURRENT_DATE).
CREATE INDEX ix_promocion_vigencia ON promocion (fecha_expira);

-- Solo UNA promocion puede ser la del banner: indice UNICO PARCIAL, algo que
-- el monolito no podia expresar con un UNIQUE comun (solo admitiria una fila
-- con destacada = 0).
CREATE UNIQUE INDEX uq_promocion_destacada ON promocion (destacada) WHERE destacada;

-- Indice PARCIAL: solo indexa los eventos pendientes. Los enviados (casi
-- todos, con el tiempo) no lo engordan y el relevo lo recorre en orden.
CREATE INDEX ix_evento_salida_pendiente ON evento_salida (id_evento) WHERE enviado_en IS NULL;
