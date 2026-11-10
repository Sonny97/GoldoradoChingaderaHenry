/**
 * Proceso de fondo de conciliacion (CONVENCIONES §4.4).
 *
 * Cada CONCILIACION_INTERVALO_MS corre servicio.conciliar(): pagos PENDIENTE
 * viejos contra Wompi, acreditaciones fallidas y libro de Mongo pendiente. Es
 * la red de seguridad para cuando el usuario cierra la pestania antes de volver
 * del banco y el webhook no llega (o llega cuando ms-apuestas estaba caido).
 *
 * Nunca se solapan dos rondas: la siguiente se programa con setTimeout cuando
 * termina la anterior (setInterval podria arrancar una ronda encima de otra
 * lenta). detener() cancela la proxima y espera la que este en curso.
 */

/**
 * @param {{ servicio: { conciliar: Function }, log: object, intervaloMs: number }} o
 */
export function crearConciliacion({ servicio, log, intervaloMs }) {
  let temporizador = null;
  let enCurso = null;
  let activo = false;

  async function ronda() {
    if (enCurso) return enCurso;
    enCurso = (async () => {
      try {
        const r = await servicio.conciliar();
        if (r.revisados || r.acreditados || r.libro || r.errores) {
          log.info(
            `Conciliacion: ${r.revisados} pendientes revisados, ${r.acreditados} acreditados, ` +
              `${r.libro} libros al dia, ${r.errores} con error`
          );
        }
        return r;
      } catch (error) {
        log.aviso(`Conciliacion fallo (se reintenta en la proxima ronda): ${error?.details ?? error?.message ?? error}`);
        return null;
      } finally {
        enCurso = null;
      }
    })();
    return enCurso;
  }

  function programar() {
    if (!activo) return;
    temporizador = setTimeout(async () => {
      await ronda();
      programar();
    }, intervaloMs);
    temporizador.unref?.();
  }

  return {
    ronda,
    iniciar() {
      if (activo || !(intervaloMs > 0)) return;
      activo = true;
      programar();
    },
    async detener() {
      activo = false;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      if (enCurso) await enCurso;
    },
  };
}
