# ms-autenticacion

Microservicio de **login** de GolDorado (SQL Server, gRPC en el puerto **50051**).
Contrato: [`proto/autenticacion.proto`](../../proto/autenticacion.proto).

Es dueño de los usuarios, sus contraseñas (hash bcrypt), roles, la ficha del
cliente (documento, teléfono, nacimiento), las cuentas de **Google** y
**Microsoft**, el **token de seguridad** (tabla `Sesion`) y las solicitudes de
recuperación de clave. Es el único proceso que conoce `JWT_SECRET`: el BFF no
verifica firmas, llama a `ValidarToken` en cada petición protegida, y por eso un
token revocado deja de servir en el acto.

## Qué cambió respecto al monolito

| Monolito | Aquí | Por qué |
|---|---|---|
| JWT autocontenido, no revocable (limitación 4.4) | Cada JWT lleva `jti` = PK de `Sesion` | Cerrar sesión (una o todas) invalida el token aunque su `exp` siga vigente |
| OTP en un `Map` en memoria (limitación 4.3) | Tabla `Solicitud_Recuperacion` con el **hash** del código | Sobrevive reinicios, sirve con varias instancias y deja auditoría |
| `Log_Sesion` en SQL Server | `logs_sesion` / `eventos_seguridad` en **ms-transacciones** (MongoDB) | Alto volumen, solo inserción; se envía con `llamadaOpcional()`: si Mongo cae, el login sigue |
| Solo correo + clave | Google y Microsoft (OIDC + PKCE) | `password_hash` admite NULL; identidad externa = (proveedor, inquilino, sujeto) |
| Validación solo en el navegador | Mismas reglas y mensajes en el servidor | `src/utils/validadores.js` es el port de `validators.js` |

Los mensajes al usuario son los mismos del monolito (`Usuario o contraseña
incorrectos`, `Tu cuenta está inactiva. Comunícate con soporte.`, `Te quedan 3
intentos.`...). Los errores viajan como estado gRPC (CONVENCIONES §3); los
errores de validación traen todos los campos en `x-datos`: `{ "campos": { "email": "..." } }`.

## RPCs

| RPC | Qué hace | Fallos |
|---|---|---|
| `IniciarSesion` | correo **o** documento + clave → Sesion + JWT | UNAUTHENTICATED (mismo mensaje para todo), PERMISSION_DENIED (inactiva) |
| `Registrar` | Usuario → Cliente → Cliente_Telefono → Usuario_Rol en **una** transacción | INVALID_ARGUMENT, ALREADY_EXISTS (correo / documento, también en carrera) |
| `ValidarToken` | firma + exp + fila Sesion viva + usuario activo → `{ idUsuario, rol, jti, perfilCompleto, expiraEn }` | UNAUTHENTICATED `Tu sesión expiró, inicia sesión de nuevo` |
| `CerrarSesion` / `CerrarTodasLasSesiones` | revoca por `jti` (idempotente) / todas las vivas | — |
| `ListarProveedores`, `UrlAutorizacionExterna`, `IniciarSesionExterna` | Google y Microsoft | FAILED_PRECONDITION (no configurado), ALREADY_EXISTS, UNAUTHENTICATED, UNAVAILABLE |
| `ObtenerUsuario`, `ActualizarPerfil`, `CompletarPerfil`, `ListarTiposDocumento` | perfil | NOT_FOUND, FAILED_PRECONDITION `Tu perfil ya está completo` |
| `BuscarCuenta` → `SolicitarCodigo` → `VerificarCodigo` → `RestablecerPassword` | recuperación de clave | FAILED_PRECONDITION con `x-datos {"tokenDead":true}` cuando hay que empezar de nuevo |

**Reglas de vinculación de Google/Microsoft** (`src/servicios/oauthServicio.js`):
la cuenta se reconoce por `(proveedor, tid, sub)`, nunca por el correo. Si el
correo ya existe: Google **con** `email_verified === true` se vincula; Microsoft
**nunca** (su claim `email` no está verificado: es la clase de fallo "nOAuth").
Si nadie tiene ese correo se crea un usuario sin clave, rol CLIENTE y perfil
incompleto (`CompletarPerfil` pide documento, teléfono y fecha de nacimiento).

## Cómo correrlo

```bash
cp .env.example .env        # y poner JWT_SECRET (mínimo 32 caracteres)
npm run db:setup            # crea GolDoradoAuth y la siembra (borra la anterior)
npm run dev                 # o: npm start
npm test                    # node --test, sin base de datos ni red
```

Sin SQL Server el servicio **arranca igual**: `Salud` responde `estado: 'error'`
con el motivo, cada RPC que toca la base responde UNAVAILABLE y la conexión se
reintenta sola en la siguiente petición. Sin ms-transacciones, el login funciona
y el log avisa que la auditoría no se registró.

Cuentas de demostración (ids fijos, CONVENCIONES §5): `demo@goldorado.co / Demo1234!`,
`valentina.mesa@hotmail.com / Vale2024*`, `admin@goldorado.co / Admin2026#` y
`andres.gomez.demo@gmail.com` (solo Google de demostración, perfil incompleto).
Código de recuperación en desarrollo: `482913` (llega en `codigoDev`).

## SQL Server

### Opción A: instalación local (la del monolito)

1. **Autenticación mixta.** SSMS → clic derecho en el servidor → Propiedades →
   Seguridad → *Modo de autenticación de SQL Server y Windows*. Reiniciar el servicio.
2. **TCP/IP en el puerto 1433.** SQL Server Configuration Manager → Configuración
   de red → Protocolos de SQLEXPRESS → TCP/IP: *Habilitado*. En Direcciones IP →
   **IPAll**: borrar *Puertos dinámicos TCP* y poner *Puerto TCP* = `1433`.
   Reiniciar el servicio (si no, `db:setup` falla con ESOCKET).
3. **Login de la aplicación**, con permiso para crear la base (dbcreator) y nada más:

   ```sql
   USE master;
   CREATE LOGIN goldorado_app WITH PASSWORD = N'GolDorado_App_2026!', CHECK_POLICY = OFF;
   ALTER SERVER ROLE dbcreator ADD MEMBER goldorado_app;
   ```

   Al crear GolDoradoAuth, `goldorado_app` queda como dueño de la base: no
   necesita `sysadmin`.
4. `.env`: `DB_SERVER=localhost`, `DB_PORT=1433`, `DB_USER=goldorado_app`,
   `DB_PASSWORD=GolDorado_App_2026!` y `npm run db:setup`.

### Opción B: docker compose

`docker compose up -d sqlserver` (raíz del monorepo) y en el `.env`:
`DB_PORT=1434`, `DB_USER=sa`, `DB_PASSWORD=GolDorado_Sa_2026!`.

### Archivos de la base (`db/`)

| Archivo | Contenido |
|---|---|
| `01_esquema.sql` | 10 tablas, toda restricción nombrada, índice filtrado de sesiones activas, índice único filtrado de `reset_token` |
| `02_datos.sql` | seed en una transacción (`XACT_ABORT`), `IDENTITY_INSERT` para los ids 1..4, verificación ≥ 2 filas por tabla |
| `03_consultas.sql` | sustentación: el login tal como lo corre el backend, LEFT vs INNER, perfiles incompletos, sesiones activas, revocar una/todas, cuentas externas, ciclo de una recuperación, errores 2627/2601/547/515, índice filtrado vs UNIQUE, dónde quedó `Log_Sesion` |
| `setup.js` / `hash.js` | `npm run db:setup` / `npm run db:hash -- "Clave"` |

Todas las fechas son **UTC** (`SYSUTCDATETIME()` y `useUTC` en el driver): el
backend compara `expira_en` con su propio reloj, y con la hora local del
servidor una sesión duraría horas de más.

## Google y Microsoft

El flujo es *Authorization Code + PKCE* hecho en el servidor: el BFF genera
`state`, `nonce` y `code_verifier` (cookie firmada), pide la URL a
`UrlAutorizacionExterna` y en el callback llama a `IniciarSesionExterna`; aquí se
cambia el `code` por tokens (con el `client_secret`, que nunca sale de este
proceso) y se valida el `id_token` con `jose`.

Las redirect URI son las del BFF vistas desde el frontend (`URL_PUBLICA_API`):

- `http://localhost:3003/api/auth/oauth/google/callback`
- `http://localhost:3003/api/auth/oauth/microsoft/callback`

Deben registrarse **exactamente** así (esquema, puerto, ruta, sin `/` final).

### Google Cloud Console

1. https://console.cloud.google.com → crear un proyecto.
2. *Google Auth Platform* (Pantalla de consentimiento de OAuth): tipo **Externo**,
   nombre de la app y correo de soporte. Alcances: `openid`, `email`, `profile`
   (no sensibles, no requieren revisión). Mientras esté en *Prueba*, agregar los
   correos que van a entrar como **usuarios de prueba**.
3. *Clientes* (Credenciales) → Crear cliente → **Aplicación web** → *URI de
   redireccionamiento autorizados*: la de Google de arriba.
4. Copiar el ID y el secreto a `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### Microsoft Entra ID

1. https://entra.microsoft.com → *Registros de aplicaciones* → Nuevo registro.
2. *Tipos de cuenta admitidos* define `MICROSOFT_TENANT`:
   cuentas de organización **y** personales → `common`; solo personales
   (Outlook/Hotmail) → `consumers`; solo de organización → `organizations`;
   un único directorio → su GUID.
3. *URI de redirección*: plataforma **Web** (no SPA: una SPA no admite secreto y
   exige cabecera `Origin`) con la URI de Microsoft de arriba.
4. *Certificados y secretos* → Nuevo secreto de cliente → copiar el **Valor**
   (no el "Id. de secreto") a `MICROSOFT_CLIENT_SECRET`; anotar su vencimiento.
   Es obligatorio: una app Web es cliente confidencial y sin secreto Entra
   responde `AADSTS7000218` aunque se use PKCE.
5. *Información general* → *Id. de aplicación (cliente)* → `MICROSOFT_CLIENT_ID`.

Validaciones del `id_token` (probadas en `test/oauth.test.js`): Google → firma
JWKS, `iss` en sus dos valores, `aud`, `exp`, `nonce`. Microsoft → firma, `aud`,
`exp`, `tid` GUID, `iss === https://login.microsoftonline.com/{tid}/v2.0`, el
`issuer` de la llave firmante (con `{tenantid}` reemplazado) igual a `iss`, el
tenant configurado y `nonce`.

## Estructura

```
src/index.js                     arranque: env -> gRPC -> SQL Server no bloqueante -> apagado ordenado
src/config/                      esquemaEnv.js (variables), env.js, db.js (UN pool por proceso)
src/grpc/handlers.js             traduce request <-> servicios
src/servicios/                   autenticacion, recuperacion, oauth, proveedoresOidc, tokens (fábricas con dependencias inyectadas)
src/repositorios/                usuarioRepo, sesionRepo, recuperacionRepo: TODO el SQL, siempre parametrizado
src/clientes/auditoria.js        ms-transacciones (RegistrarIntentoSesion, RegistrarEventoSeguridad) best-effort
src/utils/                       validadores, mask, usuarioPublico
test/                            node --test con repositorios falsos (test/apoyo/falsos.js)
```

## Limitaciones conocidas

- No hay proveedor de correo ni SMS: en producción el código OTP se genera y se
  guarda (hash), pero no se envía; el log lo advierte.
- `BuscarCuenta` dice si la cuenta no existe (decisión consciente del monolito,
  por ser demo): permite enumerar cuentas.
- Una cuenta creada desde Microsoft guarda un correo que Microsoft no verificó.
  No se usa para vincular, pero sí para la recuperación de clave.
