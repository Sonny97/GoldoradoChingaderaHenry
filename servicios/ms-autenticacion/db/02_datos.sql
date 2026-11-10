-- ==============================================================================
--  GOLDORADO - ms-autenticacion - base GolDoradoAuth
--  Motor: SQL Server (T-SQL)          Archivo 2 de 3: DATOS
--
--  Requisito del taller: minimo 2 registros por tabla. Las 10 tablas lo
--  cumplen; la consulta de verificacion esta al final del archivo.
--
--  UNA DIFERENCIA CON EL MONOLITO: los ids de Usuario se fijan a mano
--  (SET IDENTITY_INSERT). El monolito nunca escribia un id de IDENTITY porque
--  todo vivia en una sola base y las FK se resolvian por clave natural. Aqui
--  OTRAS bases apuntan a estos ids sin llave foranea (no puede haberla entre
--  motores): cuenta_saldo y apuesta en PostgreSQL, logs_sesion y transacciones
--  en MongoDB, pagos en Firestore. Si Camilo no fuera el 1 en todas, su
--  billetera quedaria colgando de otra persona (CONVENCIONES §5).
--  Despues del INSERT, SQL Server sube solo el contador de IDENTITY al mayor id
--  insertado: el primer usuario que se registre de verdad recibe el 5.
--  Los demas ids (Rol) siguen la regla del monolito: se resuelven por nombre.
--
--  Todo va dentro de una transaccion: o queda la base completa o no queda nada.
--  Un seed a medias es peor que ninguno, porque parece que funciono.
-- ==============================================================================

USE GolDoradoAuth;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;          -- cualquier error dispara ROLLBACK automatico
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- lo exigen los indices filtrados de Sesion y Solicitud_Recuperacion
GO

BEGIN TRY
BEGIN TRANSACTION;

-- ==============================================================================
-- 1. CATALOGOS CON CLAVE NATURAL
-- ==============================================================================

INSERT INTO Tipo_Documento (codigo, nombre) VALUES
    ('CC',  N'Cédula de ciudadanía'),
    ('CE',  N'Cédula de extranjería'),
    ('PA',  N'Pasaporte'),
    ('TI',  N'Tarjeta de identidad'),
    ('NIT', N'NIT');

INSERT INTO Rol (nombre, descripcion) VALUES
    (N'CLIENTE', N'Apostador registrado en la plataforma'),
    (N'ADMIN',   N'Trabajador con acceso total al backoffice'),
    (N'SOPORTE', N'Trabajador de atención al cliente');

INSERT INTO Proveedor_Identidad (codigo, nombre) VALUES
    ('LOCAL',     N'Correo y contraseña'),
    ('GOOGLE',    N'Google'),
    ('MICROSOFT', N'Microsoft');

-- ==============================================================================
-- 2. USUARIOS (ids FIJOS, ver cabecera)
--
--  password_hash trae hashes bcrypt REALES generados con db/hash.js (los mismos
--  del monolito). Las claves en claro son Demo1234!, Vale2024* y Admin2026#, y
--  no aparecen en ningun lado de la base. Andres (4) no tiene clave local:
--  entro con Google.
-- ==============================================================================

SET IDENTITY_INSERT Usuario ON;

INSERT INTO Usuario (id_usuario, email, password_hash, ultimo_login, activo, fecha_creacion) VALUES
    (1, N'demo@goldorado.co',           '$2a$10$cKMr9v8ge6apRN1qNk3XcuWTff2wnpt7fBtR.liDnyI6qMlRjtf5e', '2026-08-17T20:01:00', 1, '2026-01-10T10:00:00'),
    (2, N'valentina.mesa@hotmail.com',  '$2a$10$huWlTF4coHyn1Zp93N/t3ORFpMZRe7dM4XLKXmJny57lDew/wsdky', '2026-08-20T14:05:00', 1, '2026-02-02T15:30:00'),
    (3, N'admin@goldorado.co',          '$2a$10$27R9WlZOuERi8uEqqCEPYeK5PySjkNLCHOZw4lBu50k5RcsNnXiSK', NULL,                  1, '2026-01-05T08:00:00'),
    (4, N'andres.gomez.demo@gmail.com', NULL,                                                           '2026-09-01T18:30:00', 1, '2026-09-01T18:30:00');

SET IDENTITY_INSERT Usuario OFF;

-- El administrador (3) es Usuario pero NO Cliente: no apuesta ni tiene
-- documento. Andres (4) tampoco lo es todavia: entro con Google y su perfil
-- esta INCOMPLETO hasta que llame a CompletarPerfil. Esta es la razon de que
-- Usuario y Cliente sean dos tablas y no una con columnas medio vacias.
INSERT INTO Cliente (id_usuario, nombres, apellidos, tipo_documento, numero_documento, fecha_nacimiento) VALUES
    (1, N'Camilo',    N'Rojas', 'CC', '1012345678', '1996-03-11'),
    (2, N'Valentina', N'Mesa',  'CC', '1098765432', '1999-07-24');

-- Camilo tiene dos telefonos: exactamente el caso que justifica sacarlos a su
-- propia tabla (4FN) en vez de tener telefono_1 y telefono_2 en Cliente.
INSERT INTO Cliente_Telefono (id_usuario, numero, tipo) VALUES
    (1, '3001234567', 'MOVIL'),
    (1, '6012345678', 'FIJO'),
    (2, '3109876123', 'MOVIL');

INSERT INTO Usuario_Rol (id_usuario, id_rol, fecha_asignacion) VALUES
    (1, (SELECT id_rol FROM Rol WHERE nombre = N'CLIENTE'), '2026-01-10T10:00:00'),
    (2, (SELECT id_rol FROM Rol WHERE nombre = N'CLIENTE'), '2026-02-02T15:30:00'),
    (3, (SELECT id_rol FROM Rol WHERE nombre = N'ADMIN'),   '2026-01-05T08:00:00'),
    (4, (SELECT id_rol FROM Rol WHERE nombre = N'CLIENTE'), '2026-09-01T18:30:00');

-- ==============================================================================
-- 3. CUENTAS EXTERNAS
--
--  De DEMOSTRACION: los sub son inventados y no inician sesion de verdad
--  contra Google ni Microsoft (CONVENCIONES §5).
--   - Andres (4) se creo desde Google: inquilino '' (Google no tiene).
--   - Valentina (2) tiene clave Y Microsoft: una persona, dos formas de entrar.
--     9188040d-... es el tid fijo de las cuentas PERSONALES de Microsoft.
--     Ojo: este vinculo se siembra a mano. El backend NUNCA vincula Microsoft
--     por coincidencia de correo (el correo de Microsoft no viene verificado).
-- ==============================================================================

INSERT INTO Cuenta_Externa (id_usuario, proveedor, inquilino, sujeto, email_proveedor, nombre_proveedor, fecha_vinculacion, ultimo_uso) VALUES
    (4, 'GOOGLE',    N'',                                     N'100000000000000000004',
        N'andres.gomez.demo@gmail.com', N'Andrés Gómez',   '2026-09-01T18:30:00', '2026-09-01T18:30:00'),
    (2, 'MICROSOFT', N'9188040d-6c67-4c5b-b112-36a304b66dad', N'00000000-0000-0000-0000-000000000002',
        N'valentina.mesa@hotmail.com',  N'Valentina Mesa', '2026-08-20T14:00:00', '2026-08-20T14:05:00');

-- ==============================================================================
-- 4. SESIONES HISTORICAS (el token de seguridad)
--
--  Ninguna esta viva: todas vencieron o fueron revocadas, asi que sembrarlas no
--  deja un token valido en ningun lado. Sirven para las consultas de
--  sustentacion (sesiones por usuario, revocadas vs vencidas).
-- ==============================================================================

INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en, revocada_en, motivo_revocacion, ip, user_agent) VALUES
    -- Camilo entro con su clave y cerro sesion 40 minutos despues: REVOCADA.
    ('5e55a0de-0001-4000-8000-000000000001', 1, 'LOCAL',
     '2026-08-17T20:01:00', '2026-08-17T22:01:00', '2026-08-17T20:41:00', 'CIERRE_SESION',
     '127.0.0.1', N'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0'),
    -- Valentina entro con Microsoft y dejo que el token venciera solo: VENCIDA.
    ('5e55a0de-0002-4000-8000-000000000002', 2, 'MICROSOFT',
     '2026-08-20T14:05:00', '2026-08-20T16:05:00', NULL, NULL,
     '190.85.12.44', N'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1'),
    -- Andres entro con Google (asi se creo su cuenta); tambien VENCIDA.
    ('5e55a0de-0004-4000-8000-000000000004', 4, 'GOOGLE',
     '2026-09-01T18:30:00', '2026-09-01T20:30:00', NULL, NULL,
     '181.49.3.120', N'Mozilla/5.0 (Linux; Android 15) Chrome/131.0');

-- ==============================================================================
-- 5. SOLICITUDES DE RECUPERACION
--
--  codigo_hash es el bcrypt REAL del codigo de desarrollo 482913, generado con
--      npm run db:hash -- 482913
--  (cada fila tiene su propio salt, por eso los dos hashes son distintos).
--  Igual que con las claves: un hash bcrypt no se puede escribir a mano.
-- ==============================================================================

INSERT INTO Solicitud_Recuperacion (token, id_usuario, metodo, codigo_hash, intentos, expira_en, verificada_en, reset_token, usada_en, creada_en, ip) VALUES
    -- Valentina olvido la clave (el login fallido de las 11:15 en logs_sesion),
    -- pidio el codigo por correo, fallo una vez, acerto y la cambio (por la
    -- misma Vale2024* de la demo): ciclo COMPLETO, solicitud USADA.
    ('40accb882d1cd00330ce088ae9ab54d5ef19c25b888e81cf', 2, 'email',
     '$2a$10$vHoPu86gMF5W6gtdjMoBF.3PfGlxvjMqC3L/gK7JIza5Uos4iLj2i', 1,
     '2026-08-18T11:30:00', '2026-08-18T11:22:00', 'aa11c0de-0002-4000-8000-000000000002', '2026-08-18T11:23:00',
     '2026-08-18T11:20:00', '190.85.12.44'),
    -- Camilo la pidio por SMS, fallo dos veces y la abandono: VENCIDA.
    ('cff6bf28c6b7c07fe3654e0588f0734b3f5d56aead190201', 1, 'sms',
     '$2a$10$4KDV5eYQddtBR5CuZ25QsuibMg0UhNvbi8RsyGex5FaegsLITSYs2', 2,
     '2026-08-25T09:10:00', NULL, NULL, NULL,
     '2026-08-25T09:00:00', '127.0.0.1');

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

-- ==============================================================================
-- VERIFICACION: minimo 2 registros por tabla (requisito del taller).
-- ==============================================================================
SELECT t.tabla,
       t.registros,
       CASE WHEN t.registros >= 2 THEN 'OK' ELSE 'FALTAN' END AS cumple
FROM (
              SELECT 'Rol'                    AS tabla, COUNT(*) AS registros FROM Rol
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
GO
