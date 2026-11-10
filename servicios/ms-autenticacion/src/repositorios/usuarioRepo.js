/**
 * Acceso a datos de Usuario, Cliente, Cliente_Telefono, Usuario_Rol,
 * Tipo_Documento y Cuenta_Externa.
 *
 * TODO el SQL del servicio vive en src/repositorios/: los servicios traen las
 * reglas y los handlers solo traducen gRPC; ninguno escribe una consulta.
 *
 * TODO valor que llega de afuera entra como PARAMETRO (request.input), nunca
 * concatenado. Concatenar es lo que abre una inyeccion SQL: quien teclee
 *     ' OR 1=1 --
 * en el correo entraria como el primer usuario de la tabla. Con parametros esa
 * cadena se busca literalmente y no encuentra nada.
 *
 * Devuelve FILAS crudas (snake_case), como el monolito. La forma publica la da
 * aUsuarioPublico() en el servicio: asi los servicios se prueban con
 * repositorios falsos que devuelven filas iguales a estas.
 *
 * Un UNIQUE violado en carrera sale como Error con `duplicado` = 'email' |
 * 'documento' | 'cliente' | 'identidad_externa' | 'proveedor_vinculado' (y
 * conserva `number`, por si nadie lo atiende: entonces el comun lo traduce a
 * ALREADY_EXISTS generico).
 */

import { peticion, enTransaccion, restriccionUnicaViolada, sql } from '../config/db.js';

/**
 * SELECT base del perfil.
 *
 * LEFT JOIN a Cliente porque el administrador es Usuario pero NO Cliente, y
 * quien entro con Google/Microsoft tampoco lo es hasta completar el perfil:
 * con INNER JOIN ninguno de los dos podria entrar.
 *
 * El rol y el telefono NO van con JOIN: son relaciones de uno a MUCHOS
 * (Usuario_Rol admite varios roles, Cliente_Telefono varios numeros por 4FN).
 * Un LEFT JOIN repetiria el usuario una vez por combinacion y
 * recordset[0] seria una fila al azar. OUTER APPLY ... TOP 1 trae un solo valor
 * y `OUTER` (no CROSS) conserva al usuario aunque no tenga rol ni telefono.
 * Lo mismo para el nombre que dio el proveedor externo (el mas reciente).
 */
const SELECT_PERFIL = `
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
`;

/** Restriccion UNIQUE/PK -> nombre del dato repetido que entiende el servicio. */
const DUPLICADOS = {
  UQ_Usuario_Email: 'email',
  UQ_Cliente_Documento: 'documento',
  PK_Cliente: 'cliente',
  UQ_CuentaExterna_Identidad: 'identidad_externa',
  UQ_CuentaExterna_UsuarioProveedor: 'proveedor_vinculado',
};

function traducirDuplicado(error) {
  const restriccion = restriccionUnicaViolada(error, Object.keys(DUPLICADOS));
  if (!restriccion) return error;
  const duplicado = new Error(`Restriccion ${restriccion} violada`, { cause: error });
  duplicado.duplicado = DUPLICADOS[restriccion];
  duplicado.number = 2627;
  return duplicado;
}

/* ------------------------------------------------------------------ lecturas */

/**
 * Busca por correo O por numero de documento (el formulario acepta los dos).
 *
 * Devuelve la fila con password_hash porque quien llama necesita el hash para
 * bcrypt.compare().
 *
 * DOS parametros y no uno: numero_documento es VARCHAR, y compararlo con un
 * parametro NVARCHAR obliga a SQL Server a convertir la COLUMNA fila por fila
 * (conversion implicita): UQ_Cliente_Documento dejaria de servir como indice.
 * Cada columna recibe un parametro de su mismo tipo, y el documento solo se
 * busca si son digitos (el CHECK de Cliente no admite otra cosa).
 */
export async function buscarPorIdentificador(identificador) {
  const texto = String(identificador ?? '').trim();
  if (!texto || texto.length > 150) return null;
  const documento = /^\d{1,50}$/.test(texto) ? texto : null;

  const consulta = await peticion();
  const resultado = await consulta
    .input('email', sql.NVarChar(150), texto)
    .input('documento', sql.VarChar(50), documento)
    .query(`${SELECT_PERFIL}
    WHERE u.email = @email
       OR c.numero_documento = @documento`);

  return resultado.recordset[0] ?? null;
}

export async function buscarPorId(idUsuario) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('idUsuario', sql.BigInt, idUsuario)
    .query(`${SELECT_PERFIL} WHERE u.id_usuario = @idUsuario`);
  return resultado.recordset[0] ?? null;
}

export async function buscarPorEmail(email) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('email', sql.NVarChar(150), email)
    .query(`${SELECT_PERFIL} WHERE u.email = @email`);
  return resultado.recordset[0] ?? null;
}

export async function existeEmail(email) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('email', sql.NVarChar(150), email)
    .query('SELECT 1 AS existe FROM Usuario WHERE email = @email');
  return resultado.recordset.length > 0;
}

export async function existeDocumento(numeroDocumento) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('documento', sql.VarChar(50), numeroDocumento)
    .query('SELECT 1 AS existe FROM Cliente WHERE numero_documento = @documento');
  return resultado.recordset.length > 0;
}

/** CC primero (el 90 % de los registros), el resto por nombre. */
export async function listarTiposDocumento() {
  const consulta = await peticion();
  const resultado = await consulta.query(`
    SELECT codigo, nombre
    FROM Tipo_Documento
    ORDER BY CASE WHEN codigo = 'CC' THEN 0 ELSE 1 END, nombre
  `);
  return resultado.recordset;
}

/* ---------------------------------------------------------------- escrituras */

async function insertarFicha(nueva, idUsuario, ficha) {
  // Cliente comparte la PK con Usuario (1 a 1 primary-to-primary).
  await nueva()
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('nombres', sql.NVarChar(100), ficha.nombres)
    .input('apellidos', sql.NVarChar(100), ficha.apellidos)
    .input('tipoDoc', sql.VarChar(5), ficha.tipoDocumento)
    .input('numeroDoc', sql.VarChar(50), ficha.numeroDocumento)
    .input('nacimiento', sql.Date, ficha.fechaNacimiento)
    .query(`
      INSERT INTO Cliente (id_usuario, nombres, apellidos, tipo_documento, numero_documento, fecha_nacimiento)
      VALUES (@idUsuario, @nombres, @apellidos, @tipoDoc, @numeroDoc, @nacimiento)
    `);

  // El telefono va en su propia tabla (4FN) aunque de momento sea uno solo.
  await nueva()
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('numero', sql.VarChar(20), ficha.telefono)
    .query(`
      INSERT INTO Cliente_Telefono (id_usuario, numero, tipo)
      VALUES (@idUsuario, @numero, 'MOVIL')
    `);
}

/**
 * El rol se resuelve por NOMBRE, nunca con un id escrito a mano. Si el
 * catalogo no lo tiene, el INSERT ... SELECT no inserta nada en silencio: se
 * revisa y se aborta, para no dejar un usuario sin rol.
 */
async function asignarRol(nueva, idUsuario, rol) {
  const resultado = await nueva()
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('rol', sql.NVarChar(50), rol)
    .query(`
      INSERT INTO Usuario_Rol (id_usuario, id_rol)
      SELECT @idUsuario, id_rol FROM Rol WHERE nombre = @rol
    `);
  if (resultado.rowsAffected[0] !== 1) {
    throw new Error(`No existe el rol ${rol} en el catalogo Rol: corre npm run db:setup`);
  }
}

/** INSERT de Usuario que devuelve el id de IDENTITY sin un SELECT aparte. */
async function insertarUsuario(nueva, email, passwordHash) {
  const resultado = await nueva()
    .input('email', sql.NVarChar(150), email)
    .input('hash', sql.VarChar(255), passwordHash)
    .query(`
      INSERT INTO Usuario (email, password_hash, activo, fecha_creacion)
      OUTPUT inserted.id_usuario
      VALUES (@email, @hash, 1, SYSUTCDATETIME())
    `);
  return Number(resultado.recordset[0].id_usuario);
}

/**
 * Alta de un cliente. CUATRO tablas, UNA transaccion:
 *     Usuario -> Cliente -> Cliente_Telefono -> Usuario_Rol
 *
 * Sin transaccion, si fallara el tercer INSERT quedaria un Usuario sin ficha
 * ni rol: podria iniciar sesion a medias y ese registro roto no tendria
 * arreglo desde la interfaz. (Cuenta_Saldo ya no esta aqui: la billetera es de
 * ms-apuestas y se crea por gRPC, con creacion perezosa si eso falla.)
 */
export async function crearCliente({ email, passwordHash, ...ficha }) {
  try {
    const idUsuario = await enTransaccion(async (nueva) => {
      const id = await insertarUsuario(nueva, email, passwordHash);
      await insertarFicha(nueva, id, ficha);
      await asignarRol(nueva, id, 'CLIENTE');
      return id;
    });
    return buscarPorId(idUsuario);
  } catch (error) {
    throw traducirDuplicado(error);
  }
}

/**
 * Ficha de Cliente para quien entro con Google/Microsoft: Cliente +
 * Cliente_Telefono en una transaccion. Si otra peticion la creo primero,
 * salta PK_Cliente (duplicado 'cliente').
 */
export async function completarPerfil(idUsuario, ficha) {
  try {
    await enTransaccion((nueva) => insertarFicha(nueva, idUsuario, ficha));
    return buscarPorId(idUsuario);
  } catch (error) {
    throw traducirDuplicado(error);
  }
}

/**
 * Datos editables del perfil. Nombres y apellidos van en Cliente y el telefono
 * en Cliente_Telefono: dos tablas, una transaccion (cambiar el nombre y que
 * falle el telefono dejaria el perfil a medias).
 *
 * El correo NO se cambia aqui: es el identificador de acceso y cambiarlo exige
 * verificar la nueva direccion. La contraseña tampoco: tiene su propio flujo.
 */
export async function actualizarPerfil(idUsuario, { nombres, apellidos, telefono }) {
  await enTransaccion(async (nueva) => {
    if (nombres !== undefined || apellidos !== undefined) {
      await nueva()
        .input('idUsuario', sql.BigInt, idUsuario)
        .input('nombres', sql.NVarChar(100), nombres ?? null)
        .input('apellidos', sql.NVarChar(100), apellidos ?? null)
        .query(`
          UPDATE Cliente
             SET nombres   = COALESCE(@nombres, nombres),
                 apellidos = COALESCE(@apellidos, apellidos)
           WHERE id_usuario = @idUsuario
        `);
    }

    if (telefono !== undefined && telefono !== null) {
      // Reemplaza el movil. DELETE + INSERT y no UPDATE porque la tabla no
      // tiene PK: no hay una sola fila a la que apuntar. Tambien se borra el
      // mismo numero si estaba como FIJO: si no, UQ_ClienteTelefono rechazaria
      // el INSERT con un error que el usuario no entenderia.
      await nueva()
        .input('idUsuario', sql.BigInt, idUsuario)
        .input('numero', sql.VarChar(20), telefono)
        .query(`
          DELETE FROM Cliente_Telefono
           WHERE id_usuario = @idUsuario AND (tipo = 'MOVIL' OR numero = @numero)
        `);

      await nueva()
        .input('idUsuario', sql.BigInt, idUsuario)
        .input('numero', sql.VarChar(20), telefono)
        .query(`
          INSERT INTO Cliente_Telefono (id_usuario, numero, tipo)
          VALUES (@idUsuario, @numero, 'MOVIL')
        `);
    }
  });
  return buscarPorId(idUsuario);
}

export async function actualizarUltimoLogin(idUsuario) {
  const consulta = await peticion();
  await consulta
    .input('idUsuario', sql.BigInt, idUsuario)
    .query('UPDATE Usuario SET ultimo_login = SYSUTCDATETIME() WHERE id_usuario = @idUsuario');
}

/* --------------------------------------------------------- cuentas externas */

/**
 * La identidad externa es (proveedor, inquilino, sujeto), NUNCA el correo.
 * sujeto tiene intercalacion binaria en la tabla: la comparacion distingue
 * mayusculas aunque el parametro llegue con la intercalacion por defecto.
 */
export async function buscarCuentaExterna({ proveedor, inquilino, sujeto }) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('proveedor', sql.VarChar(20), proveedor)
    .input('inquilino', sql.NVarChar(64), inquilino)
    .input('sujeto', sql.NVarChar(255), sujeto)
    .query(`
      SELECT id_cuenta_externa, id_usuario
      FROM Cuenta_Externa
      WHERE proveedor = @proveedor AND inquilino = @inquilino AND sujeto = @sujeto
    `);
  return resultado.recordset[0] ?? null;
}

/** Marca el uso y refresca lo que el proveedor dice hoy del correo y el nombre. */
export async function registrarUsoCuentaExterna(idCuentaExterna, { email, nombre }) {
  const consulta = await peticion();
  await consulta
    .input('id', sql.BigInt, idCuentaExterna)
    .input('email', sql.NVarChar(150), email ?? null)
    .input('nombre', sql.NVarChar(150), nombre ?? null)
    .query(`
      UPDATE Cuenta_Externa
         SET ultimo_uso       = SYSUTCDATETIME(),
             email_proveedor  = COALESCE(@email, email_proveedor),
             nombre_proveedor = COALESCE(@nombre, nombre_proveedor)
       WHERE id_cuenta_externa = @id
    `);
}

async function insertarCuentaExterna(nueva, idUsuario, cuenta) {
  await nueva()
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('proveedor', sql.VarChar(20), cuenta.proveedor)
    .input('inquilino', sql.NVarChar(64), cuenta.inquilino)
    .input('sujeto', sql.NVarChar(255), cuenta.sujeto)
    .input('email', sql.NVarChar(150), cuenta.email ?? null)
    .input('nombre', sql.NVarChar(150), cuenta.nombre ?? null)
    .query(`
      INSERT INTO Cuenta_Externa (id_usuario, proveedor, inquilino, sujeto,
                                  email_proveedor, nombre_proveedor, ultimo_uso)
      VALUES (@idUsuario, @proveedor, @inquilino, @sujeto, @email, @nombre, SYSUTCDATETIME())
    `);
}

/** Vincula una identidad externa a un usuario que ya existe. */
export async function vincularCuentaExterna(idUsuario, cuenta) {
  try {
    await enTransaccion((nueva) => insertarCuentaExterna(nueva, idUsuario, cuenta));
  } catch (error) {
    throw traducirDuplicado(error);
  }
}

/**
 * Usuario nuevo desde Google/Microsoft: Usuario (SIN clave) -> Usuario_Rol
 * CLIENTE -> Cuenta_Externa, en UNA transaccion. No hay ficha de Cliente: el
 * perfil queda incompleto hasta CompletarPerfil (documento, telefono y fecha de
 * nacimiento no los da ningun proveedor).
 */
export async function crearUsuarioExterno(cuenta) {
  try {
    const idUsuario = await enTransaccion(async (nueva) => {
      const id = await insertarUsuario(nueva, cuenta.email, null);
      await asignarRol(nueva, id, 'CLIENTE');
      await insertarCuentaExterna(nueva, id, cuenta);
      return id;
    });
    return buscarPorId(idUsuario);
  } catch (error) {
    throw traducirDuplicado(error);
  }
}
