/**
 * Bandeja de salida (outbox): evento_salida.
 *
 * Las primitivas reciben la conexion de la transaccion (`tx`) para que el
 * relevo (servicios/relevoSalida.js) decida que hacer con cada evento y aqui
 * solo quede el SQL. Los eventos se toman con FOR UPDATE SKIP LOCKED: si
 * corren dos instancias de ms-apuestas, cada una se lleva filas distintas y
 * ninguna espera a la otra.
 */

/** @param {{ enTransaccion: Function }} db */
export function crearRepoSalida({ enTransaccion }) {
  async function tomarPendientes(tx, limite) {
    const { rows } = await tx.query(
      `SELECT id_evento, tipo, carga, intentos
         FROM evento_salida
        WHERE enviado_en IS NULL
        ORDER BY id_evento
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [limite]
    );
    return rows.map((fila) => ({
      id: Number(fila.id_evento),
      tipo: fila.tipo,
      carga: fila.carga, // JSONB llega ya como objeto
      intentos: Number(fila.intentos),
    }));
  }

  async function marcarEnviado(tx, idEvento) {
    // clock_timestamp() y no now(): now() es la hora de inicio de la
    // transaccion, y el lote puede tardar en enviarse.
    await tx.query(
      `UPDATE evento_salida
          SET enviado_en = clock_timestamp(), intentos = intentos + 1, ultimo_error = NULL
        WHERE id_evento = $1`,
      [idEvento]
    );
  }

  async function marcarFallido(tx, idEvento, mensaje) {
    await tx.query(
      `UPDATE evento_salida
          SET intentos = intentos + 1, ultimo_error = left($2, 500)
        WHERE id_evento = $1`,
      [idEvento, String(mensaje ?? 'error desconocido')]
    );
  }

  return { enTransaccion, tomarPendientes, marcarEnviado, marcarFallido };
}
