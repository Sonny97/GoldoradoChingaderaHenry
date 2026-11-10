-- ==============================================================================
--  GOLDORADO - ms-autenticacion - base GolDoradoAuth
--  Motor: SQL Server (T-SQL)          Archivo 3 de 3: CONSULTAS DE SUSTENTACION
--
--  Cada bloque se puede ejecutar suelto en SSMS (seleccionar + F5). Los que
--  cambian datos van dentro de BEGIN TRANSACTION ... ROLLBACK: muestran el
--  efecto y dejan la base como estaba, asi el archivo completo se puede correr
--  cuantas veces se quiera.
--
--   1. Verificacion (conteos, restricciones con nombre, indices)
--   2. LEFT vs INNER JOIN: el administrador y el perfil incompleto
--   3. La consulta del LOGIN, tal como la ejecuta el backend
--   4. Usuarios con perfil incompleto (sin Cliente)
--   5. Token de seguridad: sesiones activas, validar, revocar una y todas
--   6. Cuentas externas (Google / Microsoft)
--   7. Ciclo de vida de una recuperacion de clave
--   8. Restricciones en accion: errores 2627, 2601, 547 y 515
--   9. Indice unico FILTRADO vs UNIQUE normal
--  10. Donde quedo Log_Sesion
-- ==============================================================================

USE GolDoradoAuth;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- exigido por los indices filtrados al modificar Sesion
SET XACT_ABORT OFF;         -- si quedo en ON (02_datos.sql), los TRY/CATCH de la seccion 8 no atrapan
SET NOCOUNT ON;
GO

-- ==============================================================================
-- 1. VERIFICACION
-- ==============================================================================

-- 1.1 Registros por tabla (requisito del taller: minimo 2).
SELECT t.tabla, t.registros, CASE WHEN t.registros >= 2 THEN 'OK' ELSE 'FALTAN' END AS cumple
FROM (
              SELECT 'Rol' AS tabla, COUNT(*) AS registros FROM Rol
    UNION ALL SELECT 'Usuario',                COUNT(*) FROM Usuario
    UNION ALL SELECT 'Usuario_Rol',            COUNT(*) FROM Usuario_Rol
    UNION ALL SELECT 'Tipo_Documento',         COUNT(*) FROM Tipo_Documento
    UNION ALL SELECT 'Cliente',                COUNT(*) FROM Cliente
    UNION ALL SELECT 'Cliente_Telefono',       COUNT(*) FROM Cliente_Telefono
    UNION ALL SELECT 'Proveedor_Identidad',    COUNT(*) FROM Proveedor_Identidad
    UNION ALL SELECT 'Cuenta_Externa',         COUNT(*) FROM Cuenta_Externa
    UNION ALL SELECT 'Sesion',                 COUNT(*) FROM Sesion
    UNION ALL SELECT 'Solicitud_Recuperacion', COUNT(*) FROM Solicitud_Recuperacion
) AS t
ORDER BY t.tabla;

-- 1.2 TODAS las restricciones tienen nombre propio (ningun PK__Usuario__3213E83F).
SELECT OBJECT_NAME(o.parent_object_id) AS tabla, o.name AS restriccion, o.type_desc AS tipo
FROM sys.objects o
WHERE o.type IN ('PK', 'F', 'UQ', 'C', 'D')
ORDER BY tabla, tipo, restriccion;

-- 1.3 Indices, con el filtro de los filtrados. Fijese en que Cliente(numero_documento)
--     y Cuenta_Externa(id_usuario) ya estan cubiertos por sus UNIQUE.
SELECT OBJECT_NAME(i.object_id) AS tabla, i.name AS indice, i.type_desc AS tipo,
       i.is_unique AS unico, i.has_filter AS filtrado, i.filter_definition AS filtro
FROM sys.indexes i
JOIN sys.tables  t ON t.object_id = i.object_id
WHERE i.name IS NOT NULL
ORDER BY tabla, indice;
GO

-- ==============================================================================
-- 2. LEFT vs INNER JOIN
--    El administrador (3) es Usuario pero NO Cliente, y Andres (4) tampoco lo
--    es todavia (entro con Google). Con LEFT JOIN aparecen con NULL en las
--    columnas de Cliente; con INNER JOIN desaparecen. Por eso el login usa
--    LEFT JOIN: con INNER, ni el admin ni quien entra con Google podrian entrar.
-- ==============================================================================

SELECT u.id_usuario, u.email, c.nombres, c.numero_documento, r.nombre AS rol
FROM Usuario u
LEFT JOIN Cliente     c  ON c.id_usuario  = u.id_usuario
LEFT JOIN Usuario_Rol ur ON ur.id_usuario = u.id_usuario
LEFT JOIN Rol         r  ON r.id_rol      = ur.id_rol
ORDER BY u.id_usuario;

-- Comparar: con INNER JOIN solo salen Camilo y Valentina.
SELECT u.id_usuario, u.email, c.nombres
FROM Usuario u
INNER JOIN Cliente c ON c.id_usuario = u.id_usuario
ORDER BY u.id_usuario;
GO

-- ==============================================================================
-- 3. LA CONSULTA DEL LOGIN, tal como la ejecuta el backend
--    (src/repositorios/usuarioRepo.js -> SELECT_PERFIL + buscarPorIdentificador).
--
--    - Acepta correo O documento. Devuelve el hash para que Node lo compare con
--      bcrypt: SQL Server no compara ni ve la contraseña en texto plano.
--    - DOS parametros: numero_documento es VARCHAR; compararlo con un NVARCHAR
--      convertiria la columna fila por fila y UQ_Cliente_Documento no serviria.
--      El backend solo llena @documento si lo tecleado son digitos.
--    - Rol, telefono y nombre del proveedor con OUTER APPLY ... TOP 1: son
--      relaciones de uno a MUCHOS; con LEFT JOIN el usuario saldria repetido.
--    - NO filtra activo = 1: el backend necesita la fila para responder
--      "Tu cuenta está inactiva" en vez del mensaje generico.
--    Pruebe tambien con: @email = N'1012345678', @documento = '1012345678'
--    y con N'andres.gomez.demo@gmail.com' (sin clave: password_hash NULL).
-- ==============================================================================

DECLARE @email     NVARCHAR(150) = N'demo@goldorado.co';
DECLARE @documento VARCHAR(50)   = NULL;

    SELECT
        u.id_usuario,
        u.email,
        u.password_hash,
        u.activo,
        u.fecha_creacion,
        u.ultimo_login,
        CAST(CASE WHEN c.id_usuario IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_cliente,
        c.nombres,
        c.apellidos,
        c.tipo_documento,
        c.numero_documento,
        c.fecha_nacimiento,
        rol.nombre  AS rol,
        tel.numero  AS telefono,
        ext.nombre_proveedor,
        prov.proveedores
    FROM Usuario u
    LEFT JOIN Cliente c ON c.id_usuario = u.id_usuario
    OUTER APPLY (
        SELECT TOP 1 r.nombre
        FROM Usuario_Rol ur
        JOIN Rol r ON r.id_rol = ur.id_rol
        WHERE ur.id_usuario = u.id_usuario
        ORDER BY ur.fecha_asignacion, r.id_rol
    ) rol
    OUTER APPLY (
        SELECT TOP 1 ct.numero
        FROM Cliente_Telefono ct
        WHERE ct.id_usuario = u.id_usuario
        ORDER BY CASE WHEN ct.tipo = 'MOVIL' THEN 0 ELSE 1 END, ct.numero
    ) tel
    OUTER APPLY (
        SELECT TOP 1 ce.nombre_proveedor
        FROM Cuenta_Externa ce
        WHERE ce.id_usuario = u.id_usuario AND ce.nombre_proveedor IS NOT NULL
        ORDER BY ce.ultimo_uso DESC, ce.fecha_vinculacion DESC
    ) ext
    OUTER APPLY (
        SELECT STRING_AGG(ce.proveedor, ',') WITHIN GROUP (ORDER BY ce.proveedor) AS proveedores
        FROM Cuenta_Externa ce
        WHERE ce.id_usuario = u.id_usuario
    ) prov
    WHERE u.email = @email
       OR c.numero_documento = @documento;
GO

-- ==============================================================================
-- 4. USUARIOS CON PERFIL INCOMPLETO (sin ficha de Cliente)
--    NOT EXISTS dice exactamente la pregunta: "usuarios para los que no existe
--    un Cliente". Los de rol CLIENTE son los que CompletarPerfil debe atender
--    antes de dejarlos apostar; el ADMIN no apuesta y no necesita ficha.
-- ==============================================================================

SELECT u.id_usuario,
       u.email,
       ro.nombre AS rol,
       CASE WHEN u.password_hash IS NULL THEN N'solo cuenta externa' ELSE N'con clave local' END AS acceso,
       ISNULL(ext.proveedores, N'-') AS cuentas_externas
FROM Usuario u
OUTER APPLY (
    SELECT TOP 1 r.nombre
    FROM Usuario_Rol ur
    JOIN Rol r ON r.id_rol = ur.id_rol
    WHERE ur.id_usuario = u.id_usuario
    ORDER BY ur.fecha_asignacion, r.id_rol
) ro
OUTER APPLY (
    SELECT STRING_AGG(ce.proveedor, ',') AS proveedores
    FROM Cuenta_Externa ce
    WHERE ce.id_usuario = u.id_usuario
) ext
WHERE NOT EXISTS (SELECT 1 FROM Cliente c WHERE c.id_usuario = u.id_usuario)
ORDER BY u.id_usuario;
GO

-- ==============================================================================
-- 5. TOKEN DE SEGURIDAD (tabla Sesion)
-- ==============================================================================

-- 5.1 Todas las sesiones con su estado. Las fechas son UTC (SYSUTCDATETIME()).
SELECT s.id_usuario, u.email, s.proveedor, s.emitida_en, s.expira_en,
       s.revocada_en, s.motivo_revocacion,
       CASE WHEN s.revocada_en IS NOT NULL         THEN 'REVOCADA'
            WHEN s.expira_en <= SYSUTCDATETIME()   THEN 'VENCIDA'
            ELSE 'ACTIVA' END AS estado
FROM Sesion s
JOIN Usuario u ON u.id_usuario = s.id_usuario
ORDER BY s.emitida_en;

-- 5.2 Sesiones ACTIVAS por usuario. La condicion revocada_en IS NULL coincide
--     con el filtro de IX_Sesion_UsuarioActivas: el motor solo recorre las vivas.
SELECT u.id_usuario, u.email, COUNT(s.jti) AS sesiones_activas
FROM Usuario u
LEFT JOIN Sesion s
       ON s.id_usuario = u.id_usuario
      AND s.revocada_en IS NULL
      AND s.expira_en > SYSUTCDATETIME()
GROUP BY u.id_usuario, u.email
ORDER BY u.id_usuario;
GO

-- 5.3 ValidarToken, tal como lo corre sesionRepo.buscarParaValidar(): la
--     sesion del jti + si el usuario sigue activo + su rol ACTUAL + si ya es
--     Cliente. El backend rechaza si revocada_en no es NULL o expira_en ya paso.
DECLARE @jti UNIQUEIDENTIFIER = '5e55a0de-0001-4000-8000-000000000001';

SELECT
    s.jti,
    s.id_usuario,
    s.expira_en,
    s.revocada_en,
    u.activo,
    CAST(CASE WHEN c.id_usuario IS NULL THEN 0 ELSE 1 END AS BIT) AS tiene_cliente,
    rol.nombre AS rol
FROM Sesion s
JOIN Usuario u      ON u.id_usuario = s.id_usuario
LEFT JOIN Cliente c ON c.id_usuario = s.id_usuario
OUTER APPLY (
    SELECT TOP 1 r.nombre
    FROM Usuario_Rol ur
    JOIN Rol r ON r.id_rol = ur.id_rol
    WHERE ur.id_usuario = s.id_usuario
    ORDER BY ur.fecha_asignacion, r.id_rol
) rol
WHERE s.jti = @jti;
GO

-- 5.4 Revocar UNA (CerrarSesion) y revocar TODAS (CerrarTodasLasSesiones).
--     Demostracion dentro de una transaccion que se deshace al final.
BEGIN TRANSACTION;

    DECLARE @ahora DATETIME2 = SYSUTCDATETIME();
    DECLARE @una   UNIQUEIDENTIFIER = NEWID();

    -- Dos inicios de sesion de Camilo: uno con clave y otro con Google.
    INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en, ip, user_agent) VALUES
        (@una,    1, 'LOCAL',  @ahora, DATEADD(HOUR, 2, @ahora), '127.0.0.1', N'SSMS demo'),
        (NEWID(), 1, 'GOOGLE', @ahora, DATEADD(HOUR, 2, @ahora), '127.0.0.1', N'SSMS demo');

    -- Revocar una. "revocada_en IS NULL" la hace idempotente: la segunda vez no
    -- cambia nada (ni la hora ni el motivo del primer cierre).
    UPDATE Sesion SET revocada_en = @ahora, motivo_revocacion = 'CIERRE_SESION'
     WHERE jti = @una AND revocada_en IS NULL;
    SELECT @@ROWCOUNT AS revocadas_primera_vez;   -- 1

    UPDATE Sesion SET revocada_en = @ahora, motivo_revocacion = 'CIERRE_SESION'
     WHERE jti = @una AND revocada_en IS NULL;
    SELECT @@ROWCOUNT AS revocadas_segunda_vez;   -- 0

    -- Revocar todas las que siguen VIVAS (las vencidas ya no abren nada).
    UPDATE Sesion SET revocada_en = @ahora, motivo_revocacion = 'CIERRE_TODAS'
     WHERE id_usuario = 1 AND revocada_en IS NULL AND expira_en > @ahora;
    SELECT @@ROWCOUNT AS sesiones_cerradas;       -- 1 (la de Google)

    SELECT jti, proveedor, emitida_en, revocada_en, motivo_revocacion
    FROM Sesion
    WHERE id_usuario = 1
    ORDER BY emitida_en;

ROLLBACK TRANSACTION;
GO

-- ==============================================================================
-- 6. CUENTAS EXTERNAS (Google / Microsoft)
-- ==============================================================================

-- 6.1 Cuentas externas por usuario.
SELECT u.id_usuario, u.email, p.nombre AS proveedor, ce.inquilino, ce.sujeto,
       ce.email_proveedor, ce.nombre_proveedor, ce.fecha_vinculacion, ce.ultimo_uso
FROM Cuenta_Externa ce
JOIN Usuario             u ON u.id_usuario = ce.id_usuario
JOIN Proveedor_Identidad p ON p.codigo     = ce.proveedor
ORDER BY u.id_usuario, ce.proveedor;

-- 6.2 Formas de entrar de cada usuario: clave local y/o proveedores.
SELECT u.id_usuario,
       u.email,
       CASE WHEN u.password_hash IS NULL THEN 'no' ELSE 'si' END AS clave_local,
       ISNULL((SELECT STRING_AGG(ce.proveedor, ', ') WITHIN GROUP (ORDER BY ce.proveedor)
               FROM Cuenta_Externa ce
               WHERE ce.id_usuario = u.id_usuario), '-') AS cuentas_externas
FROM Usuario u
ORDER BY u.id_usuario;
GO

-- 6.3 La busqueda del callback (usuarioRepo.buscarCuentaExterna): la identidad
--     es (proveedor, inquilino, sujeto). El correo NO participa.
DECLARE @proveedor VARCHAR(20)   = 'MICROSOFT';
DECLARE @inquilino NVARCHAR(64)  = N'9188040d-6c67-4c5b-b112-36a304b66dad';
DECLARE @sujeto    NVARCHAR(255) = N'00000000-0000-0000-0000-000000000002';

SELECT id_cuenta_externa, id_usuario
FROM Cuenta_Externa
WHERE proveedor = @proveedor AND inquilino = @inquilino AND sujeto = @sujeto;
GO

-- 6.4 sujeto distingue mayusculas (intercalacion BINARIA): dos `sub` de
--     Microsoft que solo difieren en mayusculas son DOS personas.
BEGIN TRANSACTION;
    INSERT INTO Cuenta_Externa (id_usuario, proveedor, inquilino, sujeto) VALUES
        (1, 'MICROSOFT', N'72f988bf-86f1-41af-91ab-2d7cd011db47', N'AbCdEf123'),
        (3, 'MICROSOFT', N'72f988bf-86f1-41af-91ab-2d7cd011db47', N'abcdef123');
    SELECT id_usuario, sujeto FROM Cuenta_Externa WHERE inquilino = N'72f988bf-86f1-41af-91ab-2d7cd011db47';
ROLLBACK TRANSACTION;
GO

-- ==============================================================================
-- 7. CICLO DE VIDA DE UNA RECUPERACION DE CLAVE (los 4 pasos del backend)
-- ==============================================================================

-- 7.1 Estado de cada solicitud (la tabla es la auditoria: nada se borra).
SELECT u.email, sr.metodo, sr.creada_en, sr.intentos, sr.expira_en, sr.verificada_en, sr.usada_en,
       CASE WHEN sr.usada_en IS NOT NULL           THEN 'USADA'
            WHEN sr.expira_en <= SYSUTCDATETIME()  THEN 'VENCIDA'
            WHEN sr.intentos >= 5                  THEN 'AGOTADA'
            WHEN sr.verificada_en IS NOT NULL      THEN 'VERIFICADA'
            ELSE 'PENDIENTE' END AS estado
FROM Solicitud_Recuperacion sr
JOIN Usuario u ON u.id_usuario = sr.id_usuario
ORDER BY sr.creada_en;
GO

-- 7.2 Recorrido completo, deshecho al final.
BEGIN TRANSACTION;

    DECLARE @token CHAR(48)  = '0123456789abcdef0123456789abcdef0123456789abcdef';
    DECLARE @ahora DATETIME2 = SYSUTCDATETIME();
    DECLARE @reset UNIQUEIDENTIFIER = NEWID();

    -- Paso 2 (SolicitarCodigo): se guarda el bcrypt de 482913, nunca el codigo.
    INSERT INTO Solicitud_Recuperacion (token, id_usuario, metodo, codigo_hash, expira_en, creada_en, ip)
    VALUES (@token, 1, 'email', '$2a$10$vHoPu86gMF5W6gtdjMoBF.3PfGlxvjMqC3L/gK7JIza5Uos4iLj2i',
            DATEADD(MINUTE, 10, @ahora), @ahora, '127.0.0.1');

    -- Paso 3 con codigo equivocado: incremento ATOMICO con tope en el WHERE.
    -- Dos pestañas fallando a la vez no pueden pasar de 5.
    UPDATE Solicitud_Recuperacion
       SET intentos = intentos + 1
    OUTPUT inserted.intentos AS intentos_usados
     WHERE token = @token AND intentos < 5;

    -- Paso 3 con el codigo correcto: verificada + reset_token (NO se consume).
    UPDATE Solicitud_Recuperacion
       SET verificada_en = @ahora, reset_token = @reset
     WHERE token = @token AND usada_en IS NULL;

    -- Paso 4 (RestablecerPassword): consumir es lo PRIMERO y es de un solo uso.
    UPDATE Solicitud_Recuperacion
       SET usada_en = @ahora
     WHERE token = @token AND usada_en IS NULL AND reset_token IS NOT NULL AND expira_en > @ahora;
    SELECT @@ROWCOUNT AS consumida_primera_vez;    -- 1

    UPDATE Solicitud_Recuperacion
       SET usada_en = @ahora
     WHERE token = @token AND usada_en IS NULL AND reset_token IS NOT NULL AND expira_en > @ahora;
    SELECT @@ROWCOUNT AS consumida_segunda_vez;    -- 0: el mismo enlace no sirve dos veces

    SELECT token, metodo, intentos, expira_en, verificada_en, reset_token, usada_en
    FROM Solicitud_Recuperacion
    WHERE token = @token;

ROLLBACK TRANSACTION;
GO

-- ==============================================================================
-- 8. RESTRICCIONES EN ACCION
--    Validar en el backend es comodidad; la garantia esta en la base. Cada
--    bloque provoca el error a proposito y lo atrapa para mostrar su numero.
--    Son los mismos numeros que traduce traducirErrorBaseDatos() en
--    @goldorado/comun (2627/2601 -> ALREADY_EXISTS, 547 -> FAILED_PRECONDITION,
--    515 -> INVALID_ARGUMENT).
--    Ningun ejemplo inserta en Usuario: un INSERT fallido gasta un valor de
--    IDENTITY (los huecos no se recuperan ni con ROLLBACK) y el siguiente
--    registro real ya no seria el 5.
-- ==============================================================================

-- 8.1 Error 2627 (UNIQUE): el documento de Camilo para la ficha del admin.
BEGIN TRY
    INSERT INTO Cliente (id_usuario, nombres, apellidos, tipo_documento, numero_documento, fecha_nacimiento)
    VALUES (3, N'Admin', N'Goldorado', 'CC', '1012345678', '1990-01-01');
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_2627, ERROR_MESSAGE() AS mensaje;   -- UQ_Cliente_Documento
END CATCH;

-- 8.2 Error 2627 (PRIMARY KEY): un jti que ya existe. Dos tokens no pueden
--     compartir la misma fila de Sesion.
BEGIN TRY
    INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en)
    VALUES ('5e55a0de-0001-4000-8000-000000000001', 1, 'LOCAL', SYSUTCDATETIME(), DATEADD(HOUR, 2, SYSUTCDATETIME()));
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_2627, ERROR_MESSAGE() AS mensaje;   -- PK_Sesion
END CATCH;

-- 8.3 Error 2601 (indice UNICO): reutilizar el reset_token de Valentina en la
--     solicitud de Camilo. Es 2601 y no 2627 porque lo protege un INDICE unico
--     (filtrado), no una restriccion UNIQUE.
BEGIN TRY
    UPDATE Solicitud_Recuperacion
       SET verificada_en = SYSUTCDATETIME(), reset_token = 'aa11c0de-0002-4000-8000-000000000002'
     WHERE token = 'cff6bf28c6b7c07fe3654e0588f0734b3f5d56aead190201';
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_2601, ERROR_MESSAGE() AS mensaje;   -- UQ_SolicitudRecuperacion_ResetToken
END CATCH;

-- 8.4 Error 547 (FOREIGN KEY): sesion para un usuario que no existe.
BEGIN TRY
    INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en)
    VALUES (NEWID(), 999, 'LOCAL', SYSUTCDATETIME(), DATEADD(HOUR, 2, SYSUTCDATETIME()));
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_547, ERROR_MESSAGE() AS mensaje;    -- FK_Sesion_Usuario
END CATCH;

-- 8.5 Error 547 (CHECK): guardar una clave EN CLARO. La base solo acepta algo
--     con forma de bcrypt; un descuido del backend no puede filtrar la clave.
BEGIN TRY
    UPDATE Usuario SET password_hash = 'Demo1234!' WHERE id_usuario = 1;
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_547, ERROR_MESSAGE() AS mensaje;    -- CHK_Usuario_PasswordHash
END CATCH;

-- 8.6 Error 547 (CHECK): una sesion que vence antes de emitirse.
BEGIN TRY
    INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en)
    VALUES (NEWID(), 1, 'LOCAL', SYSUTCDATETIME(), DATEADD(HOUR, -1, SYSUTCDATETIME()));
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_547, ERROR_MESSAGE() AS mensaje;    -- CHK_Sesion_Vigencia
END CATCH;

-- 8.7 Error 547 (CHECK): una cuenta de Microsoft sin tid. Su identidad es
--     (tid, sub); sin tid quedaria a medias.
BEGIN TRY
    INSERT INTO Cuenta_Externa (id_usuario, proveedor, inquilino, sujeto)
    VALUES (1, 'MICROSOFT', N'', N'sub-sin-tenant');
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_547, ERROR_MESSAGE() AS mensaje;    -- CHK_CuentaExterna_Inquilino
END CATCH;

-- 8.8 Error 515 (NOT NULL): una sesion sin vencimiento. Un token eterno no
--     se puede guardar.
BEGIN TRY
    INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en)
    VALUES (NEWID(), 1, 'LOCAL', SYSUTCDATETIME(), NULL);
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_515, ERROR_MESSAGE() AS mensaje;
END CATCH;
GO

-- ==============================================================================
-- 9. INDICE UNICO FILTRADO vs UNIQUE NORMAL
--    reset_token es unico... pero casi siempre es NULL (nadie ha verificado).
-- ==============================================================================

-- 9.1 Varias solicitudes conviven con reset_token NULL sin ningun problema:
SELECT COUNT(*) AS solicitudes_sin_reset_token
FROM Solicitud_Recuperacion
WHERE reset_token IS NULL;

-- 9.2 ...porque el indice solo contiene las filas que SI tienen reset_token:
SELECT name AS indice, is_unique AS unico, has_filter AS filtrado, filter_definition AS filtro
FROM sys.indexes
WHERE name = 'UQ_SolicitudRecuperacion_ResetToken';

-- 9.3 Contraste: con un UNIQUE normal, SQL Server admite UN SOLO NULL y la
--     segunda solicitud sin verificar ya fallaria (2627).
--     (Variable de tabla y restriccion SIN nombre a proposito: los nombres de
--     restriccion de objetos temporales viven en tempdb y dos sesiones que
--     corrieran esto a la vez chocarian con el error 2714.)
DECLARE @UniqueNormal TABLE (reset_token UNIQUEIDENTIFIER NULL UNIQUE);
INSERT INTO @UniqueNormal (reset_token) VALUES (NULL);
BEGIN TRY
    INSERT INTO @UniqueNormal (reset_token) VALUES (NULL);
END TRY
BEGIN CATCH
    SELECT ERROR_NUMBER() AS numero_esperado_2627, N'UNIQUE normal: el segundo NULL se rechaza' AS explicacion;
END CATCH;
GO

-- ==============================================================================
-- 10. ¿Y Log_Sesion?
--    Ya no vive en SQL Server. Los intentos de acceso (exitosos y fallidos) y
--    los eventos de seguridad se mudaron a ms-transacciones (MongoDB, base
--    goldorado_transacciones, colecciones logs_sesion y eventos_seguridad):
--    son de solo insercion, de alto volumen, y cada proveedor (LOCAL, GOOGLE,
--    MICROSOFT) aporta campos distintos. Este servicio los envia por gRPC con
--    llamadaOpcional(): si Mongo esta caido, el login funciona igual.
--
--    Lo que se gano: la base de login no crece con cada intento de un bot.
--    Lo que se perdio: la FK a Usuario. logs_sesion.idUsuario es un id SIN
--    llave foranea (no puede haberla entre motores, CONVENCIONES §4).
--
--    La consulta equivalente ("intentos fallidos por correo") esta en
--    servicios/ms-transacciones/db/03_consultas.js (mongosh).
-- ==============================================================================

SELECT CASE WHEN OBJECT_ID('dbo.Log_Sesion') IS NULL
            THEN N'Log_Sesion no existe aqui: ver ms-transacciones (MongoDB, logs_sesion)'
            ELSE N'Log_Sesion todavia existe: revisar 01_esquema.sql' END AS donde_esta_log_sesion;
GO
