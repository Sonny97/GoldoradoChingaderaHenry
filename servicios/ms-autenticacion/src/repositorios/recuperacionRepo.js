/**
 * Acceso a Solicitud_Recuperacion: la recuperacion de clave PERSISTIDA.
 *
 * En el monolito esto era recuperacionStore.js, un Map en memoria, con tres
 * consecuencias documentadas: se perdia al reiniciar (nodemon reinicia al
 * guardar), no servia con dos instancias y no dejaba auditoria. Aqui cada
 * solicitud es una fila que NO se borra: "eliminar" pasa a ser marcarla
 * agotada o usada.
 *
 * Las decisiones (vencida, agotada, de un solo uso) las toma el servicio con
 * su reloj; este modulo solo trae filas y hace los cambios de forma ATOMICA,
 * porque dos pestañas pueden enviar el mismo codigo a la vez.
 */

import { peticion, enTransaccion, sql } from '../config/db.js';

const TOKEN_VALIDO = /^[0-9a-f]{48}$/i;
const GUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNAS = `
    token, id_usuario, metodo, codigo_hash, intentos, expira_en,
    verificada_en, reset_token, usada_en, creada_en
`;

export async function crear({ token, idUsuario, metodo, codigoHash, expiraEn, creadaEn, ip }) {
  const consulta = await peticion();
  await consulta
    .input('token', sql.Char(48), token)
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('metodo', sql.VarChar(5), metodo)
    .input('hash', sql.VarChar(60), codigoHash)
    .input('expira', sql.DateTime2, expiraEn)
    .input('creada', sql.DateTime2, creadaEn)
    .input('ip', sql.VarChar(45), ip ? String(ip).slice(0, 45) : null)
    .query(`
      INSERT INTO Solicitud_Recuperacion (token, id_usuario, metodo, codigo_hash, expira_en, creada_en, ip)
      VALUES (@token, @idUsuario, @metodo, @hash, @expira, @creada, @ip)
    `);
}

/**
 * Lo que manda el navegador se valida ANTES de llegar a la base: un token
 * con otro formato no puede existir, y un reset_token que no es GUID haria
 * fallar la conversion a UNIQUEIDENTIFIER con un error 500.
 */
export async function buscarPorToken(token) {
  if (!TOKEN_VALIDO.test(String(token ?? ''))) return null;
  const consulta = await peticion();
  const resultado = await consulta
    .input('token', sql.Char(48), token)
    .query(`SELECT ${COLUMNAS} FROM Solicitud_Recuperacion WHERE token = @token`);
  return resultado.recordset[0] ?? null;
}

export async function buscarPorResetToken(resetToken) {
  if (!GUID_VALIDO.test(String(resetToken ?? ''))) return null;
  const consulta = await peticion();
  const resultado = await consulta
    .input('reset', sql.UniqueIdentifier, resetToken)
    .query(`SELECT ${COLUMNAS} FROM Solicitud_Recuperacion WHERE reset_token = @reset`);
  return resultado.recordset[0] ?? null;
}

/**
 * Suma un intento fallido y devuelve el total, o null si ya estaba en el tope.
 * El tope va en el WHERE: dos codigos equivocados enviados a la vez no pueden
 * pasarse del maximo (leer, sumar en Node y escribir si podria).
 */
export async function sumarIntento(token, maximo) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('token', sql.Char(48), token)
    .input('maximo', sql.TinyInt, maximo)
    .query(`
      UPDATE Solicitud_Recuperacion
         SET intentos = intentos + 1
      OUTPUT inserted.intentos
       WHERE token = @token AND intentos < @maximo
    `);
  return resultado.recordset[0]?.intentos ?? null;
}

/**
 * Codigo correcto: la solicitud NO se borra, se marca verificada y recibe su
 * reset_token (lo mismo que hacia el monolito en memoria). Si se verifica dos
 * veces, el reset_token nuevo reemplaza al anterior.
 */
export async function marcarVerificada(token, resetToken, ahora) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('token', sql.Char(48), token)
    .input('reset', sql.UniqueIdentifier, resetToken)
    .input('ahora', sql.DateTime2, ahora)
    .query(`
      UPDATE Solicitud_Recuperacion
         SET verificada_en = @ahora, reset_token = @reset
       WHERE token = @token AND usada_en IS NULL
    `);
  return (resultado.rowsAffected[0] ?? 0) > 0;
}

/**
 * Paso 4 en UNA transaccion:
 *   1. consume la solicitud (de un solo uso; el WHERE lo garantiza aunque
 *      lleguen dos peticiones con el mismo reset_token),
 *   2. guarda el hash nuevo (solo si la cuenta sigue activa),
 *   3. revoca TODAS las sesiones vivas: si alguien conocia la clave vieja y
 *      tenia un token abierto, lo pierde en el acto.
 * La solicitud se consume aunque la cuenta este inactiva (como el monolito:
 * "se consume pase lo que pase").
 */
export async function consumirYCambiarPassword({ token, idUsuario, passwordHash, ahora }) {
  return enTransaccion(async (nueva) => {
    const consumo = await nueva()
      .input('token', sql.Char(48), token)
      .input('ahora', sql.DateTime2, ahora)
      .query(`
        UPDATE Solicitud_Recuperacion
           SET usada_en = @ahora
         WHERE token = @token
           AND usada_en IS NULL
           AND reset_token IS NOT NULL
           AND expira_en > @ahora
      `);
    if ((consumo.rowsAffected[0] ?? 0) === 0) {
      return { consumida: false, actualizado: false, sesionesRevocadas: 0 };
    }

    const cambio = await nueva()
      .input('idUsuario', sql.BigInt, idUsuario)
      .input('hash', sql.VarChar(255), passwordHash)
      .query(`
        UPDATE Usuario SET password_hash = @hash
         WHERE id_usuario = @idUsuario AND activo = 1
      `);
    const actualizado = (cambio.rowsAffected[0] ?? 0) > 0;

    let sesionesRevocadas = 0;
    if (actualizado) {
      const revocadas = await nueva()
        .input('idUsuario', sql.BigInt, idUsuario)
        .input('ahora', sql.DateTime2, ahora)
        .query(`
          UPDATE Sesion
             SET revocada_en = @ahora, motivo_revocacion = 'RESTABLECER_PASSWORD'
           WHERE id_usuario = @idUsuario
             AND revocada_en IS NULL
             AND expira_en > @ahora
        `);
      sesionesRevocadas = revocadas.rowsAffected[0] ?? 0;
    }

    return { consumida: true, actualizado, sesionesRevocadas };
  });
}
