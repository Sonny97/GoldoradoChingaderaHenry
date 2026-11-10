/**
 * Acceso a la tabla Sesion: el "token de seguridad".
 *
 * Cada JWT emitido tiene aqui su fila (jti = PK). Es lo que hace revocable un
 * token que, por si solo, seria valido hasta su exp (limitacion 4.4 del
 * monolito).
 *
 * Las horas (emitida, revocada, "ahora") las pone el SERVICIO con su reloj, no
 * SYSUTCDATETIME(): asi la fila y el exp del JWT salen del mismo reloj y las
 * pruebas pueden usar un reloj falso.
 */

import { peticion, sql } from '../config/db.js';

export async function crear({ jti, idUsuario, proveedor, emitidaEn, expiraEn, ip, userAgent }) {
  const consulta = await peticion();
  await consulta
    .input('jti', sql.UniqueIdentifier, jti)
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('proveedor', sql.VarChar(20), proveedor)
    .input('emitida', sql.DateTime2, emitidaEn)
    .input('expira', sql.DateTime2, expiraEn)
    .input('ip', sql.VarChar(45), ip ? String(ip).slice(0, 45) : null)
    .input('agente', sql.NVarChar(255), userAgent ? String(userAgent).slice(0, 255) : null)
    .query(`
      INSERT INTO Sesion (jti, id_usuario, proveedor, emitida_en, expira_en, ip, user_agent)
      VALUES (@jti, @idUsuario, @proveedor, @emitida, @expira, @ip, @agente)
    `);
}

/**
 * Lo que ValidarToken necesita en UNA consulta: la sesion, si el usuario
 * sigue activo, su rol ACTUAL (no el que quedo escrito en el JWT: si a alguien
 * le quitan el rol ADMIN, deja de serlo en la siguiente peticion) y si ya
 * tiene ficha de Cliente.
 */
export async function buscarParaValidar(jti) {
  const consulta = await peticion();
  const resultado = await consulta.input('jti', sql.UniqueIdentifier, jti).query(`
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
      WHERE s.jti = @jti
    `);
  return resultado.recordset[0] ?? null;
}

/**
 * Revoca UNA sesion. `revocada_en IS NULL` la hace idempotente: cerrar dos
 * veces no reescribe la hora ni el motivo del primer cierre.
 * Devuelve cuantas filas cambio (0 o 1).
 */
export async function revocar(jti, motivo, ahora) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('jti', sql.UniqueIdentifier, jti)
    .input('motivo', sql.VarChar(30), motivo)
    .input('ahora', sql.DateTime2, ahora)
    .query(`
      UPDATE Sesion
         SET revocada_en = @ahora, motivo_revocacion = @motivo
       WHERE jti = @jti AND revocada_en IS NULL
    `);
  return resultado.rowsAffected[0] ?? 0;
}

/**
 * "Cerrar sesion en todos mis dispositivos". Solo cuenta las que seguian
 * VIVAS: una vencida ya no abre nada y contarla inflaria el numero que ve el
 * usuario. Usa IX_Sesion_UsuarioActivas (filtrado por revocada_en IS NULL).
 */
export async function revocarTodas(idUsuario, motivo, ahora) {
  const consulta = await peticion();
  const resultado = await consulta
    .input('idUsuario', sql.BigInt, idUsuario)
    .input('motivo', sql.VarChar(30), motivo)
    .input('ahora', sql.DateTime2, ahora)
    .query(`
      UPDATE Sesion
         SET revocada_en = @ahora, motivo_revocacion = @motivo
       WHERE id_usuario = @idUsuario
         AND revocada_en IS NULL
         AND expira_en > @ahora
    `);
  return resultado.rowsAffected[0] ?? 0;
}
