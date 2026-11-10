/**
 * Cuotas y apuestas: registrarlas y consultarlas.
 *
 * Aqui sigue estando la operacion mas delicada del proyecto, porque mueve
 * dinero. En el monolito tocaba cuatro tablas de SQL Server; aqui toca
 * cuenta_saldo, apuesta, movimiento_saldo y evento_salida, todas en UNA
 * transaccion de PostgreSQL. El libro contable (MongoDB) se entera despues por
 * la bandeja de salida: nunca hay una transaccion distribuida a medias.
 *
 * Fabrica con la conexion inyectada: importar este archivo no abre nada.
 */

import { aFechaHoraIso, aNumero } from '@goldorado/comun';

/** Fila de cuota_oferta + opcion_mercado -> forma del mensaje Cuota. */
function aCuota(fila) {
  return {
    idCuota: Number(fila.id_cuota),
    idEncuentro: Number(fila.id_encuentro),
    codigoCorto: fila.codigo_corto,
    seleccion: fila.seleccion,
    valor: aNumero(fila.valor_cuota),
    mercado: fila.codigo_mercado,
    estado: fila.estado,
    orden: Number(fila.orden),
  };
}

/** @param {{ consultar: Function, enTransaccion: Function }} db */
export function crearRepoApuestas({ consultar, enTransaccion }) {
  /**
   * La cuota junto a la regla que le aplica, en una sola consulta.
   *
   * El estado del partido ya NO sale de aqui: vive en MySQL y lo responde
   * ms-deportes. LEFT JOIN LATERAL es el OUTER APPLY del monolito: un mercado
   * podria no tener regla configurada; asi la consulta devuelve la cuota igual
   * y el servicio da un mensaje claro en vez de "cuota no encontrada", que
   * seria mentira.
   */
  async function contextoDeCuota(idCuota) {
    const { rows } = await consultar(
      `SELECT co.id_cuota,
              co.valor_cuota,
              co.estado        AS estado_cuota,
              co.id_encuentro,
              om.seleccion,
              om.codigo_mercado,
              ra.id_regla,
              ra.monto_minimo,
              ra.monto_maximo,
              ra.nombre        AS regla_nombre
         FROM cuota_oferta co
         JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
         LEFT JOIN LATERAL (
              SELECT r.id_regla, r.monto_minimo, r.monto_maximo, r.nombre
                FROM regla_apuesta r
               WHERE r.codigo_mercado = om.codigo_mercado
               ORDER BY r.id_regla
               LIMIT 1
         ) ra ON true
        WHERE co.id_cuota = $1`,
      [idCuota]
    );

    const fila = rows[0];
    if (!fila) return null;

    return {
      idCuota: Number(fila.id_cuota),
      valorCuota: aNumero(fila.valor_cuota),
      estadoCuota: fila.estado_cuota,
      idEncuentro: Number(fila.id_encuentro),
      seleccion: fila.seleccion,
      mercado: fila.codigo_mercado,
      idRegla: fila.id_regla === null ? null : Number(fila.id_regla),
      montoMinimo: aNumero(fila.monto_minimo),
      montoMaximo: aNumero(fila.monto_maximo),
      reglaNombre: fila.regla_nombre,
    };
  }

  /**
   * Registra la apuesta moviendo el dinero, todo dentro de UNA transaccion.
   *
   * EL DETALLE IMPORTANTE ESTA EN EL UPDATE:
   *
   *     WHERE id_usuario = $1 AND saldo_disponible >= $2
   *
   * La condicion del saldo va DENTRO del UPDATE, no en un SELECT previo. Si se
   * consultara el saldo, se comparara en Node y despues se descontara, dos
   * peticiones simultaneas del mismo cliente podrian leer 50.000 las dos y el
   * saldo terminaria en negativo. Con la condicion en el WHERE el motor lee y
   * escribe en una sola operacion atomica: la segunda afecta 0 filas y se cae
   * sola (y si se colara, CHECK saldo_disponible >= 0 la detiene).
   *
   * El dinero no desaparece: pasa de saldo_disponible a saldo_bloqueado.
   *
   * `cargaEvento({ idApuesta, fecha })` arma el evento del libro contable; lo
   * decide el servicio, aqui solo se guarda en la misma transaccion.
   *
   * Devuelve null si no habia saldo suficiente.
   */
  async function registrarApuesta({ idUsuario, idCuota, idRegla, monto, cuotaFijada, idTransaccion, cargaEvento }) {
    return enTransaccion(async (tx) => {
      // 0. Creacion perezosa de la billetera: si AsegurarBilletera fallo al
      //    registrarse, la cuenta nace aqui en 0 (y el UPDATE dira "Saldo
      //    insuficiente"). Si no hay saldo se hace COMMIT igual: lo unico que
      //    quedo escrito es esa billetera vacia, que debia existir de todos modos.
      await tx.query(
        `INSERT INTO cuenta_saldo (id_usuario) VALUES ($1)
         ON CONFLICT ON CONSTRAINT pk_cuenta_saldo DO NOTHING`,
        [idUsuario]
      );

      // 1. Descuento atomico del saldo.
      const saldo = await tx.query(
        `UPDATE cuenta_saldo
            SET saldo_disponible = saldo_disponible - $2,
                saldo_bloqueado  = saldo_bloqueado  + $2,
                actualizado_en   = now()
          WHERE id_usuario = $1
            AND saldo_disponible >= $2
         RETURNING saldo_disponible, saldo_bloqueado`,
        [idUsuario, monto]
      );
      if (saldo.rowCount === 0) return null;

      // 2. La apuesta. cuota_fijada es el snapshot del momento: si la cuota se
      //    mueve despues, esta apuesta se sigue liquidando con este valor.
      //    ganancia_potencial no se inserta: la calcula la base (GENERATED).
      const apuesta = await tx.query(
        `INSERT INTO apuesta (id_usuario, id_cuota, id_regla, id_transaccion, monto_apostado, cuota_fijada)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id_apuesta, ganancia_potencial, fecha_apuesta`,
        [idUsuario, idCuota, idRegla, idTransaccion, monto, cuotaFijada]
      );
      const fila = apuesta.rows[0];
      const idApuesta = Number(fila.id_apuesta);
      const saldoDisponible = saldo.rows[0].saldo_disponible;

      // 3. Diario de la billetera. monto siempre positivo: el signo lo da el
      //    tipo. referencia = el UUID de la transaccion, la misma clave que
      //    usara Mongo, para poder cruzar los dos libros.
      await tx.query(
        `INSERT INTO movimiento_saldo (id_usuario, tipo, monto, saldo_disponible_resultante, referencia)
         VALUES ($1, 'APUESTA', $2, $3, $4)`,
        [idUsuario, monto, saldoDisponible, idTransaccion]
      );

      // 4. Bandeja de salida: el evento para ms-transacciones se guarda en la
      //    MISMA transaccion. Si Mongo esta caido, la apuesta no se pierde ni
      //    se duplica: el relevo lo envia cuando vuelva.
      const fecha = aFechaHoraIso(fila.fecha_apuesta);
      await tx.query(`INSERT INTO evento_salida (tipo, carga) VALUES ('TRANSACCION', $1::jsonb)`, [
        JSON.stringify(cargaEvento({ idApuesta, fecha })),
      ]);

      return {
        idApuesta,
        idTransaccion,
        monto: aNumero(monto),
        cuota: aNumero(cuotaFijada),
        gananciaPotencial: aNumero(fila.ganancia_potencial),
        fecha,
        saldoDisponible: aNumero(saldoDisponible),
        saldoBloqueado: aNumero(saldo.rows[0].saldo_bloqueado),
      };
    });
  }

  /**
   * Historial del cliente, de la mas reciente a la mas antigua.
   * Los nombres de los equipos viven en MySQL: el BFF hidrata id_encuentro con
   * ms-deportes (no hay JOIN posible entre motores).
   */
  async function listarApuestasDeUsuario(idUsuario, { limite = 20 } = {}) {
    const { rows } = await consultar(
      `SELECT a.id_apuesta, a.estado_apuesta, a.monto_apostado, a.cuota_fijada,
              a.ganancia_potencial, a.fecha_apuesta, a.id_transaccion,
              om.seleccion, om.codigo_mercado, co.id_encuentro
         FROM apuesta a
         JOIN cuota_oferta   co ON co.id_cuota  = a.id_cuota
         JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
        WHERE a.id_usuario = $1
        ORDER BY a.fecha_apuesta DESC, a.id_apuesta DESC
        LIMIT $2`,
      [idUsuario, limite]
    );

    return rows.map((fila) => ({
      id: Number(fila.id_apuesta),
      estado: fila.estado_apuesta,
      monto: aNumero(fila.monto_apostado),
      cuota: aNumero(fila.cuota_fijada),
      gananciaPotencial: aNumero(fila.ganancia_potencial),
      fecha: aFechaHoraIso(fila.fecha_apuesta),
      seleccion: fila.seleccion,
      mercado: fila.codigo_mercado,
      idEncuentro: Number(fila.id_encuentro),
      idTransaccion: fila.id_transaccion,
    }));
  }

  /**
   * Totales para el panel "Tu semana".
   * FILTER (WHERE ...) es la forma de PostgreSQL del SUM(CASE ...) del
   * monolito: explicito, y no depende de que COUNT(columna) ignore los NULL.
   */
  async function resumenDeUsuario(idUsuario) {
    const { rows } = await consultar(
      `SELECT COUNT(*)                                             AS total,
              COUNT(*) FILTER (WHERE estado_apuesta = 'GANADA')    AS ganadas,
              COUNT(*) FILTER (WHERE estado_apuesta = 'PERDIDA')   AS perdidas,
              COUNT(*) FILTER (WHERE estado_apuesta = 'PENDIENTE') AS pendientes,
              COALESCE(SUM(monto_apostado), 0)                     AS total_apostado,
              COALESCE(SUM(ganancia_potencial) FILTER (WHERE estado_apuesta = 'GANADA'), 0) AS total_ganado
         FROM apuesta
        WHERE id_usuario = $1`,
      [idUsuario]
    );

    const fila = rows[0];
    return {
      total: Number(fila.total),
      ganadas: Number(fila.ganadas),
      perdidas: Number(fila.perdidas),
      pendientes: Number(fila.pendientes),
      apostado: aNumero(fila.total_apostado) ?? 0,
      retornado: aNumero(fila.total_ganado) ?? 0,
    };
  }

  /** Todas las cuotas de esos encuentros, por encuentro y posicion del chip. */
  async function cuotasPorEncuentros(idsEncuentro) {
    if (!idsEncuentro || idsEncuentro.length === 0) return [];
    const { rows } = await consultar(
      `SELECT co.id_cuota, co.id_encuentro, om.codigo_corto, om.seleccion,
              co.valor_cuota, om.codigo_mercado, co.estado, om.orden
         FROM cuota_oferta co
         JOIN opcion_mercado om ON om.id_opcion = co.id_opcion
        WHERE co.id_encuentro = ANY($1::bigint[])
        ORDER BY co.id_encuentro, om.orden`,
      [idsEncuentro]
    );
    return rows.map(aCuota);
  }

  return { contextoDeCuota, registrarApuesta, listarApuestasDeUsuario, resumenDeUsuario, cuotasPorEncuentros };
}
