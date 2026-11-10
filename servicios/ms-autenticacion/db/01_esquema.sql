-- ==============================================================================
--  GOLDORADO - ms-autenticacion - base GolDoradoAuth
--  Motor: SQL Server (T-SQL)          Archivo 1 de 3: ESTRUCTURA
--
--  Lo que el tablero llama "loguin": usuario, contraseña y token de seguridad,
--  mas las cuentas de Google y Microsoft. Sale de la seccion 5 (Seguridad,
--  roles y usuarios) de ApuestasFutbol del monolito, con tres cambios:
--
--   1. Sesion = el "token de seguridad". En el monolito el JWT era
--      autocontenido y no se podia revocar antes de vencer (limitacion 4.4 de
--      la sustentacion). Ahora cada JWT lleva un jti que es la PK de Sesion:
--      cerrar sesion marca la fila revocada y ValidarToken la consulta.
--   2. Solicitud_Recuperacion: el codigo OTP vivia en un Map en memoria
--      (limitacion 4.3: se perdia al reiniciar, no servia con dos instancias
--      y no dejaba auditoria). Ahora es tabla, y guarda el HASH del codigo.
--   3. Proveedor_Identidad + Cuenta_Externa: inicio de sesion con Google y
--      Microsoft. Usuario.password_hash pasa a admitir NULL.
--
--  QUE YA NO ESTA AQUI: Log_Sesion y Log_Transaccion se mudaron a
--  ms-transacciones (MongoDB: logs_sesion, eventos_seguridad, transacciones).
--  Son de solo insercion, de alto volumen y de esquema flexible. Este servicio
--  los envia por gRPC con llamadaOpcional(): si Mongo esta caido, el login
--  funciona igual. Cuenta_Saldo tampoco esta: el dinero es de ms-apuestas, que
--  apunta a Usuario.id_usuario SIN llave foranea (otro motor).
--
--  CONVENCIONES (las del monolito, con un ajuste en las fechas)
--   - NVARCHAR + N'...' en todo texto que pueda llevar tildes o eñe.
--   - DATETIME2 con SYSUTCDATETIME() (no GETDATE(), que es DATETIME de
--     3,33 ms). Se usa la variante UTC y no SYSDATETIME() porque aqui la hora
--     decide la seguridad: el backend compara expira_en con su reloj (UTC) y el
--     driver lee con useUTC. Con la hora local de un servidor en Bogota, una
--     sesion de 2 h quedaria guardada como si durara 7.
--   - TODA restriccion va nombrada (PK_, FK_, UQ_, CHK_, DF_, IX_). Un error
--     que nombra FK__Sesion__id_us__1A2B3C4D es imposible de explicar.
--     DEFAULT es restriccion de COLUMNA: dentro de CREATE TABLE va pegada a la
--     columna; "CONSTRAINT ... DEFAULT ... FOR col" solo existe en ALTER TABLE.
--   - Las tablas de rompimiento (Usuario_Rol, Cliente_Telefono) NO llevan PK:
--     solo sus FK y un UNIQUE que evita duplicados.
--   - Catalogos con clave natural (Tipo_Documento, Proveedor_Identidad): el
--     codigo YA identifica la fila. IDENTITY queda para registros repetitivos.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. CREACION DE LA BASE
-- ------------------------------------------------------------------------------
-- DROP DATABASE falla con el error 3702 si alguien esta conectado (una pestaña
-- de SSMS abierta). SINGLE_USER WITH ROLLBACK IMMEDIATE expulsa esas sesiones
-- para que el script se pueda re-ejecutar siempre.
USE master;
GO

-- Los indices FILTRADOS exigen estas dos opciones al crearse y en cada INSERT
-- o UPDATE. SSMS y el driver de Node ya las traen en ON; sqlcmd no (usar -I).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF DB_ID('GolDoradoAuth') IS NOT NULL
BEGIN
    ALTER DATABASE GolDoradoAuth SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE GolDoradoAuth;
END
GO

CREATE DATABASE GolDoradoAuth;
GO

USE GolDoradoAuth;
GO

-- ==============================================================================
-- 1. ROLES Y USUARIOS
-- ==============================================================================

CREATE TABLE Rol (
    id_rol      INT           IDENTITY(1,1) NOT NULL,
    nombre      NVARCHAR(50)  NOT NULL,
    descripcion NVARCHAR(255) NULL,

    CONSTRAINT PK_Rol        PRIMARY KEY (id_rol),
    CONSTRAINT UQ_Rol_Nombre UNIQUE (nombre)
);
GO

-- password_hash guarda el bcrypt calculado EN EL BACKEND: SQL Server nunca ve
-- ni compara la contraseña en claro.
-- Admite NULL desde que existen Google y Microsoft: una cuenta creada desde un
-- proveedor externo no tiene clave local (puede crearla con "Olvidé mi
-- contraseña"). El login local trata NULL igual que una clave incorrecta.
-- CHK_Usuario_PasswordHash es la garantia de que nadie guarde una clave en
-- claro por error: un bcrypt mide 60 y empieza por $2a$/$2b$/$2y$ y el costo.
-- El UNIQUE del correo usa la intercalacion por defecto (CI): Demo@GolDorado.co
-- y demo@goldorado.co son el mismo correo, que es justo lo que se quiere.
CREATE TABLE Usuario (
    id_usuario     BIGINT        IDENTITY(1,1) NOT NULL,
    email          NVARCHAR(150) NOT NULL,
    password_hash  VARCHAR(255)  NULL,
    ultimo_login   DATETIME2     NULL,
    activo         BIT           NOT NULL
                   CONSTRAINT DF_Usuario_Activo DEFAULT 1,
    fecha_creacion DATETIME2     NOT NULL
                   CONSTRAINT DF_Usuario_Fecha  DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_Usuario               PRIMARY KEY (id_usuario),
    CONSTRAINT UQ_Usuario_Email         UNIQUE (email),
    CONSTRAINT CHK_Usuario_Email        CHECK (email LIKE N'_%@_%._%'),
    CONSTRAINT CHK_Usuario_PasswordHash CHECK (
        password_hash IS NULL
        OR (LEN(password_hash) = 60 AND password_hash LIKE '$2[aby]$[0-9][0-9]$%')
    )
);
GO

-- Rompimiento N a N. Sin PRIMARY KEY: solo FK y un UNIQUE para no asignar dos
-- veces el mismo rol al mismo usuario.
CREATE TABLE Usuario_Rol (
    id_usuario       BIGINT    NOT NULL,
    id_rol           INT       NOT NULL,
    fecha_asignacion DATETIME2 NOT NULL
                     CONSTRAINT DF_UsuarioRol_Fecha DEFAULT SYSUTCDATETIME(),

    CONSTRAINT FK_UsuarioRol_Usuario FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
    CONSTRAINT FK_UsuarioRol_Rol     FOREIGN KEY (id_rol)     REFERENCES Rol(id_rol),
    CONSTRAINT UQ_UsuarioRol         UNIQUE (id_usuario, id_rol)
);
GO

-- ==============================================================================
-- 2. FICHA DEL CLIENTE
-- ==============================================================================

-- Catalogo con clave natural: 'CC' identifica el tipo mejor que un 1.
CREATE TABLE Tipo_Documento (
    codigo VARCHAR(5)   NOT NULL,
    nombre NVARCHAR(50) NOT NULL,

    CONSTRAINT PK_TipoDocumento        PRIMARY KEY (codigo),
    CONSTRAINT UQ_TipoDocumento_Nombre UNIQUE (nombre)
);
GO

-- 1 A 1 CON USUARIO (primary-to-primary): id_usuario es PK y FK a la vez.
-- Un cliente no puede existir sin su usuario ni haber dos para el mismo.
-- El administrador es Usuario pero NO Cliente, y quien entra con Google o
-- Microsoft tampoco lo es hasta completar el perfil (CompletarPerfil): por eso
-- el login usa LEFT JOIN.
-- Los dos CHECK repiten en la base lo que valida el backend (comodidad alli,
-- garantia aqui). El de mayoria de edad usa la fecha UTC del servidor: puede
-- ser un dia mas permisivo que el backend, que calcula la edad con la fecha de
-- Bogota; nunca es mas estricto, asi que no rechaza a nadie que el backend acepte.
CREATE TABLE Cliente (
    id_usuario       BIGINT        NOT NULL,
    nombres          NVARCHAR(100) NOT NULL,
    apellidos        NVARCHAR(100) NOT NULL,
    tipo_documento   VARCHAR(5)    NOT NULL,
    numero_documento VARCHAR(50)   NOT NULL,
    fecha_nacimiento DATE          NOT NULL,

    CONSTRAINT PK_Cliente              PRIMARY KEY (id_usuario),
    CONSTRAINT FK_Cliente_Usuario      FOREIGN KEY (id_usuario)     REFERENCES Usuario(id_usuario),
    CONSTRAINT FK_Cliente_TipoDoc      FOREIGN KEY (tipo_documento) REFERENCES Tipo_Documento(codigo),
    -- Este UNIQUE ES el indice de Cliente(numero_documento) que usa el login
    -- por documento: un IX_ aparte lo duplicaria y cada INSERT pagaria dos.
    CONSTRAINT UQ_Cliente_Documento    UNIQUE (numero_documento),
    CONSTRAINT CHK_Cliente_Documento   CHECK (LEN(numero_documento) BETWEEN 6 AND 15
                                              AND numero_documento NOT LIKE '%[^0-9]%'),
    CONSTRAINT CHK_Cliente_MayorDeEdad CHECK (fecha_nacimiento <= DATEADD(YEAR, -18, CAST(SYSUTCDATETIME() AS DATE)))
);
GO

-- 4FN: un cliente puede tener varios telefonos. Tabla de rompimiento, sin PK.
CREATE TABLE Cliente_Telefono (
    id_usuario BIGINT      NOT NULL,
    numero     VARCHAR(20) NOT NULL,
    tipo       VARCHAR(15) NOT NULL
               CONSTRAINT DF_ClienteTelefono_Tipo DEFAULT 'MOVIL',

    CONSTRAINT FK_ClienteTelefono_Cliente FOREIGN KEY (id_usuario) REFERENCES Cliente(id_usuario),
    CONSTRAINT CHK_ClienteTelefono_Tipo   CHECK (tipo IN ('MOVIL', 'FIJO')),
    CONSTRAINT CHK_ClienteTelefono_Numero CHECK (LEN(numero) BETWEEN 7 AND 15 AND numero NOT LIKE '%[^0-9]%'),
    CONSTRAINT UQ_ClienteTelefono         UNIQUE (id_usuario, numero)
);
GO

-- ==============================================================================
-- 3. IDENTIDADES EXTERNAS (Google, Microsoft)
-- ==============================================================================

-- Catalogo con clave natural. LOCAL existe para que Sesion.proveedor diga
-- siempre COMO se inicio cada sesion (contraseña, Google o Microsoft).
CREATE TABLE Proveedor_Identidad (
    codigo VARCHAR(20)  NOT NULL,
    nombre NVARCHAR(50) NOT NULL,

    CONSTRAINT PK_ProveedorIdentidad        PRIMARY KEY (codigo),
    CONSTRAINT UQ_ProveedorIdentidad_Nombre UNIQUE (nombre)
);
GO

-- Una identidad de Google o Microsoft vinculada a un Usuario.
--
-- QUIEN es la persona lo dice el proveedor con (inquilino, sujeto), NUNCA el
-- correo:
--   Google:    sujeto = claim `sub` (unico, nunca cambia); inquilino = ''.
--   Microsoft: sujeto = `sub` e inquilino = `tid` (GUID del directorio). El
--              mismo `sub` en otro `tid` es OTRA persona. Y el correo de
--              Microsoft no viene verificado: usarlo como identidad (la clase
--              de fallo "nOAuth") dejaria entrar a una cuenta ajena a quien cree
--              un directorio propio con ese correo.
-- inquilino es NOT NULL con '' para Google: con NULL, la busqueda
-- WHERE inquilino = @inquilino nunca encontraria la cuenta (NULL = NULL no es
-- verdadero) y cada login de Google exigiria un caso especial.
-- sujeto usa intercalacion BINARIA: el `sub` distingue mayusculas (Microsoft lo
-- emite en base64url) y con la intercalacion por defecto (CI) dos personas
-- distintas podrian quedar como la misma.
CREATE TABLE Cuenta_Externa (
    id_cuenta_externa BIGINT        IDENTITY(1,1) NOT NULL,
    id_usuario        BIGINT        NOT NULL,
    proveedor         VARCHAR(20)   NOT NULL,
    inquilino         NVARCHAR(64)  NOT NULL
                      CONSTRAINT DF_CuentaExterna_Inquilino DEFAULT N'',
    sujeto            NVARCHAR(255) COLLATE Latin1_General_100_BIN2 NOT NULL,
    email_proveedor   NVARCHAR(150) NULL,   -- informativo: nunca se usa para autorizar
    nombre_proveedor  NVARCHAR(150) NULL,   -- para saludar a quien aun no completa el perfil
    fecha_vinculacion DATETIME2     NOT NULL
                      CONSTRAINT DF_CuentaExterna_Fecha DEFAULT SYSUTCDATETIME(),
    ultimo_uso        DATETIME2     NULL,

    CONSTRAINT PK_CuentaExterna           PRIMARY KEY (id_cuenta_externa),
    CONSTRAINT FK_CuentaExterna_Usuario   FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
    CONSTRAINT FK_CuentaExterna_Proveedor FOREIGN KEY (proveedor)  REFERENCES Proveedor_Identidad(codigo),
    -- Una identidad externa pertenece a UN solo usuario.
    CONSTRAINT UQ_CuentaExterna_Identidad UNIQUE (proveedor, inquilino, sujeto),
    -- A lo sumo una cuenta por proveedor y usuario. Su indice (id_usuario
    -- primero) ES el indice de Cuenta_Externa(id_usuario): no se duplica.
    CONSTRAINT UQ_CuentaExterna_UsuarioProveedor UNIQUE (id_usuario, proveedor),
    -- LOCAL no es una cuenta externa.
    CONSTRAINT CHK_CuentaExterna_Proveedor CHECK (proveedor <> 'LOCAL'),
    -- Microsoft siempre trae tid: sin el, la identidad (tid, sub) queda a medias.
    CONSTRAINT CHK_CuentaExterna_Inquilino CHECK (proveedor <> 'MICROSOFT' OR inquilino <> N'')
);
GO

-- ==============================================================================
-- 4. TOKEN DE SEGURIDAD Y RECUPERACION DE CLAVE
-- ==============================================================================

-- EL TOKEN DE SEGURIDAD. Cada JWT lleva un jti (UUID) que es la PK de esta
-- tabla. ValidarToken exige que la fila exista, no este revocada y no haya
-- vencido: cerrar sesion deja el token inservible EN EL ACTO aunque su firma y
-- su exp sigan siendo validos.
--
-- PK NONCLUSTERED: el jti es aleatorio (UUID v4). Como indice agrupado cada
-- INSERT caeria en una pagina al azar y la partiria (fragmentacion). El indice
-- agrupado va por emitida_en, que crece en orden.
CREATE TABLE Sesion (
    jti               UNIQUEIDENTIFIER NOT NULL,
    id_usuario        BIGINT           NOT NULL,
    proveedor         VARCHAR(20)      NOT NULL,
    emitida_en        DATETIME2        NOT NULL
                      CONSTRAINT DF_Sesion_Emitida DEFAULT SYSUTCDATETIME(),
    expira_en         DATETIME2        NOT NULL,
    revocada_en       DATETIME2        NULL,
    motivo_revocacion VARCHAR(30)      NULL,
    ip                VARCHAR(45)      NULL,   -- 45 = largo maximo de una IPv6
    user_agent        NVARCHAR(255)    NULL,

    CONSTRAINT PK_Sesion             PRIMARY KEY NONCLUSTERED (jti),
    CONSTRAINT FK_Sesion_Usuario     FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
    CONSTRAINT FK_Sesion_Proveedor   FOREIGN KEY (proveedor)  REFERENCES Proveedor_Identidad(codigo),
    CONSTRAINT CHK_Sesion_Vigencia   CHECK (expira_en > emitida_en),
    -- Una sesion revocada SIEMPRE dice por que (como motivo_fallo en Log_Sesion).
    CONSTRAINT CHK_Sesion_Revocacion CHECK (revocada_en IS NULL OR motivo_revocacion IS NOT NULL),
    CONSTRAINT CHK_Sesion_Motivo     CHECK (motivo_revocacion IN ('CIERRE_SESION', 'CIERRE_TODAS', 'RESTABLECER_PASSWORD'))
);
GO

CREATE CLUSTERED INDEX IX_Sesion_Emitida ON Sesion (emitida_en);
GO

-- Sesiones VIVAS de un usuario ("cerrar sesion en todos mis dispositivos").
-- FILTRADO: solo indexa las no revocadas, que son las que se buscan; las
-- revocadas, que con el tiempo son la mayoria, no ocupan lugar en el.
CREATE NONCLUSTERED INDEX IX_Sesion_UsuarioActivas
    ON Sesion (id_usuario)
    INCLUDE (expira_en)
    WHERE revocada_en IS NULL;
GO

-- Recuperacion de contraseña PERSISTIDA.
--   token        identifica la solicitud ante el navegador (24 bytes
--                aleatorios en hex). NO es el codigo.
--   codigo_hash  bcrypt del codigo de 6 digitos. El codigo en claro no se
--                guarda: quien lea la tabla no puede completar recuperaciones.
--   intentos     codigos equivocados; al llegar al tope la solicitud muere.
--   reset_token  nace al acertar el codigo y autoriza UN cambio de clave.
--   usada_en     consumo del reset_token. La fila NO se borra: queda la
--                auditoria de cuantas recuperaciones hubo sobre una cuenta.
CREATE TABLE Solicitud_Recuperacion (
    token         CHAR(48)         NOT NULL,
    id_usuario    BIGINT           NOT NULL,
    metodo        VARCHAR(5)       NOT NULL,
    codigo_hash   VARCHAR(60)      NOT NULL,
    intentos      TINYINT          NOT NULL
                  CONSTRAINT DF_SolicitudRecuperacion_Intentos DEFAULT 0,
    expira_en     DATETIME2        NOT NULL,
    verificada_en DATETIME2        NULL,
    reset_token   UNIQUEIDENTIFIER NULL,
    usada_en      DATETIME2        NULL,
    creada_en     DATETIME2        NOT NULL
                  CONSTRAINT DF_SolicitudRecuperacion_Creada DEFAULT SYSUTCDATETIME(),
    ip            VARCHAR(45)      NULL,

    CONSTRAINT PK_SolicitudRecuperacion           PRIMARY KEY (token),
    CONSTRAINT FK_SolicitudRecuperacion_Usuario   FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario),
    CONSTRAINT CHK_SolicitudRecuperacion_Metodo   CHECK (metodo IN ('email', 'sms')),
    CONSTRAINT CHK_SolicitudRecuperacion_Hash     CHECK (LEN(codigo_hash) = 60 AND codigo_hash LIKE '$2[aby]$%'),
    CONSTRAINT CHK_SolicitudRecuperacion_Vigencia CHECK (expira_en > creada_en),
    -- El reset_token solo existe despues de acertar el codigo...
    CONSTRAINT CHK_SolicitudRecuperacion_Reset    CHECK (reset_token IS NULL OR verificada_en IS NOT NULL),
    -- ...y solo se consume una solicitud que lo tiene.
    CONSTRAINT CHK_SolicitudRecuperacion_Uso      CHECK (usada_en IS NULL OR reset_token IS NOT NULL)
);
GO

-- reset_token es unico, pero casi todas las filas lo tienen en NULL (nadie ha
-- verificado aun). Un UNIQUE normal de SQL Server admite UN SOLO NULL: la
-- segunda solicitud sin verificar fallaria con el error 2627. El indice unico
-- FILTRADO aplica la unicidad solo a los valores reales (2601 si se repite).
CREATE UNIQUE NONCLUSTERED INDEX UQ_SolicitudRecuperacion_ResetToken
    ON Solicitud_Recuperacion (reset_token)
    WHERE reset_token IS NOT NULL;
GO

-- Historial de recuperaciones de una cuenta (auditoria, 03_consultas.sql).
CREATE NONCLUSTERED INDEX IX_SolicitudRecuperacion_Usuario
    ON Solicitud_Recuperacion (id_usuario, creada_en);
GO

PRINT N'GolDoradoAuth creada: 10 tablas.';
GO
