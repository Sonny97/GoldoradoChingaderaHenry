/**
 * Billetera (cuenta_saldo) y su diario (movimiento_saldo).
 *
 * La billetera es 1 a 1 con el usuario de ms-autenticacion (SQL Server): su PK
 * es ese id, sin llave foranea posible entre motores. Por eso se crea de forma
 * perezosa e idempotente (INSERT ... ON CONFLICT DO NOTHING) cada vez que hace
 * falta, en vez de confiar en que el registro la creo.
 */

import { aNumero } from '@goldorado/comun';

const COLUMNAS = 'id_usuario, saldo_disponible, saldo_bloqueado, moneda';

function aBilletera(fila) {
  return {
    idUsuario: Number(fila.id_usuario),
    saldoDisponible: aNumero(fila.saldo_disponible),
    saldoBloqueado: aNumero(fila.saldo_bloqueado),
    moneda: fila.moneda,
  };
}

/** @param {{ consultar: Function, enTransaccion: Function }} db */
export function crearRepoBilletera({ consultar, enTransaccion }) {
  const SQL_ASEGURAR = `INSERT INTO cuenta_saldo (id_usuario) VALUES ($1)
                        ON CONFLICT ON CONSTRAINT pk_cuenta_saldo DO NOTHING`;
  const SQL_OBTENER = `SELECT ${COLUMNAS} FROM cuenta_saldo WHERE id_usuario = $1`;

  /**
   * Crea la billetera en 0 si no existe y la devuelve.
   * Dos sentencias y no un CTE: si otra peticion la crea al mismo tiempo, el
   * SELECT (con instantanea nueva) ya la ve; un CTE con la instantanea vieja
   * podria devolver cero filas.
   */
  async function asegurar(idUsuario) {
    await consultar(SQL_ASEGURAR, [idUsuario]);
    const { rows } = await consultar(SQL_OBTENER, [idUsuario]);
    return aBilletera(rows[0]);
  }

  async function obtener(idUsuario) {
    const { rows } = await consultar(SQL_OBTENER, [idUsuario]);
    return rows[0] ? aBilletera(rows[0]) : null;
  }

  /**
   * Acredita un deposito aprobado por Wompi. IDEMPOTENTE por `referencia`.
   *
   * El webhook de Wompi y la conciliacion de ms-pagos pueden llegar los dos con
   * el mismo pago: el UNIQUE de movimiento_saldo.referencia decide cual entra.
   * Primero se intenta el diario y solo si la fila nacio se suma el saldo; un
   * reintento no inserta nada y no toca el dinero.
   *
   * Devuelve { aplicado, billetera } o { conflicto: true } si la referencia ya
   * existe pero es de OTRO usuario u otro tipo de movimiento (eso no es un
   * reintento, es un error que no se debe esconder).
   */
  async function acreditarDeposito({ idUsuario, monto, referencia, proveedor, metodo, idTransaccionPasarela }) {
    return enTransaccion(async (tx) => {
      await tx.query(SQL_ASEGURAR, [idUsuario]);

      // Bloquea la fila de la billetera: saldo_disponible_resultante del diario
      // debe ser el real aunque una apuesta del mismo cliente corra a la vez.
      await tx.query('SELECT 1 FROM cuenta_saldo WHERE id_usuario = $1 FOR UPDATE', [idUsuario]);

      const insertado = await tx.query(
        `INSERT INTO movimiento_saldo (id_usuario, tipo, monto, saldo_disponible_resultante,
                                       referencia, proveedor, metodo, id_transaccion_pasarela)
         SELECT cs.id_usuario, 'DEPOSITO', $2::numeric, cs.saldo_disponible + $2::numeric,
                $3::varchar, $4::varchar, $5::varchar, $6::varchar
           FROM cuenta_saldo cs
          WHERE cs.id_usuario = $1
         ON CONFLICT ON CONSTRAINT uq_movimiento_saldo_referencia DO NOTHING
         RETURNING id_movimiento`,
        [idUsuario, monto, referencia, proveedor, metodo, idTransaccionPasarela]
      );

      if (insertado.rowCount === 0) {
        const previo = await tx.query('SELECT id_usuario, tipo FROM movimiento_saldo WHERE referencia = $1', [
          referencia,
        ]);
        const mov = previo.rows[0];
        if (mov && (Number(mov.id_usuario) !== Number(idUsuario) || mov.tipo !== 'DEPOSITO')) {
          return { conflicto: true };
        }
        const actual = await tx.query(SQL_OBTENER, [idUsuario]);
        return { aplicado: false, billetera: aBilletera(actual.rows[0]) };
      }

      const { rows } = await tx.query(
        `UPDATE cuenta_saldo
            SET saldo_disponible = saldo_disponible + $2,
                actualizado_en   = now()
          WHERE id_usuario = $1
         RETURNING ${COLUMNAS}`,
        [idUsuario, monto]
      );
      return { aplicado: true, billetera: aBilletera(rows[0]) };
    });
  }

  return { asegurar, obtener, acreditarDeposito };
}
