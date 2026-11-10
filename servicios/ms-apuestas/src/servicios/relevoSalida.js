/**
 * Relevo de la bandeja de salida (outbox) hacia ms-transacciones.
 *
 * La apuesta escribe su evento en evento_salida dentro de la MISMA transaccion
 * que descuenta el saldo. Este proceso de fondo los lee cada
 * OUTBOX_INTERVALO_MS y los envia por gRPC (RegistrarTransaccion). Si Mongo o
 * ms-transacciones estan caidos, los eventos esperan y se reintentan: la
 * apuesta nunca se pierde ni se duplica, solo llega al libro un poco despues.
 *
 * Decisiones:
 * - Un lote por ciclo, en una transaccion con FOR UPDATE SKIP LOCKED (ver
 *   salidaRepo): varias instancias del servicio no se pisan.
 * - Los ciclos NUNCA se solapan: el siguiente se programa cuando termina el
 *   anterior, y ejecutar() devuelve el ciclo en curso si ya hay uno.
 * - RegistrarTransaccion es idempotente por `codigo`: reenviar un evento que
 *   Mongo ya tenia es inofensivo (ALREADY_EXISTS cuenta como enviado).
 * - Si ms-transacciones no responde, se corta el lote (no tiene sentido
 *   esperar 20 plazos seguidos) y se avisa UNA vez, no cada 3 segundos; lo
 *   mismo si la que falla es PostgreSQL. Al recuperarse se dice una vez.
 */

import { CODIGOS } from '@goldorado/comun';

/** Codigos gRPC que significan "el otro lado no esta", no "el evento esta mal". */
const CODIGOS_CAIDA = new Set([CODIGOS.UNAVAILABLE, CODIGOS.DEADLINE_EXCEEDED, CODIGOS.CANCELLED]);

const describir = (error) => error?.details || error?.message || String(error);

/**
 * @param {object} o
 * @param {object} o.repo  crearRepoSalida(): enTransaccion, tomarPendientes, marcarEnviado, marcarFallido
 * @param {{ registrarTransaccion: (carga: object) => Promise<any> }} o.transacciones
 * @param {object} o.log
 * @param {number} [o.intervaloMs]
 * @param {number} [o.lote]
 */
export function crearRelevoSalida({ repo, transacciones, log, intervaloMs = 3000, lote = 20 }) {
  let activo = false;
  let temporizador = null;
  let enCurso = null;
  let transaccionesCaido = false;
  let baseCaida = false;

  function marcarTransaccionesCaido(error) {
    if (transaccionesCaido) {
      log.debug?.(`ms-transacciones sigue sin responder: ${describir(error)}`);
      return;
    }
    transaccionesCaido = true;
    log.aviso(
      `ms-transacciones no responde (${describir(error)}). Los eventos quedan en evento_salida y se reintentan cada ${intervaloMs} ms.`
    );
  }

  function marcarTransaccionesArriba() {
    if (!transaccionesCaido) return;
    transaccionesCaido = false;
    log.info('ms-transacciones respondio de nuevo: se reanuda el envio de la bandeja de salida.');
  }

  async function procesarLote() {
    return repo.enTransaccion(async (tx) => {
      const eventos = await repo.tomarPendientes(tx, lote);
      const resumen = { tomados: eventos.length, enviados: 0, fallidos: 0 };

      for (const evento of eventos) {
        if (evento.tipo !== 'TRANSACCION') {
          await repo.marcarFallido(tx, evento.id, `Tipo de evento desconocido: ${evento.tipo}`);
          resumen.fallidos += 1;
          continue;
        }

        try {
          await transacciones.registrarTransaccion(evento.carga);
          await repo.marcarEnviado(tx, evento.id);
          resumen.enviados += 1;
          marcarTransaccionesArriba();
        } catch (error) {
          if (error?.code === CODIGOS.ALREADY_EXISTS) {
            // Ya estaba en el libro (un envio anterior llego pero no alcanzo a marcarse).
            await repo.marcarEnviado(tx, evento.id);
            resumen.enviados += 1;
            marcarTransaccionesArriba();
            continue;
          }

          await repo.marcarFallido(tx, evento.id, describir(error));
          resumen.fallidos += 1;

          if (CODIGOS_CAIDA.has(error?.code)) {
            marcarTransaccionesCaido(error);
            break;
          }
          // El evento fue rechazado (dato invalido): queda con ultimo_error para
          // revisarlo, y el resto del lote sigue su curso.
          log.aviso(`Evento ${evento.id} rechazado por ms-transacciones: ${describir(error)}`);
        }
      }

      return resumen;
    });
  }

  /** Un ciclo. Si ya hay uno en curso devuelve ese mismo: nunca corren dos a la vez. */
  function ejecutar() {
    if (enCurso) return enCurso;

    enCurso = procesarLote()
      .then((resumen) => {
        if (baseCaida) {
          baseCaida = false;
          log.info('PostgreSQL respondio de nuevo: el relevo de la bandeja de salida continua.');
        }
        if (resumen.enviados > 0) log.debug?.(`Bandeja de salida: ${resumen.enviados} evento(s) enviados`);
        return resumen;
      })
      .catch((error) => {
        if (!baseCaida) {
          baseCaida = true;
          log.aviso(`Relevo de la bandeja de salida en pausa: ${error?.message ?? error}. Se reintenta cada ${intervaloMs} ms.`);
        }
        return { tomados: 0, enviados: 0, fallidos: 0, error: error?.message ?? String(error) };
      })
      .finally(() => {
        enCurso = null;
      });

    return enCurso;
  }

  function programar() {
    if (!activo) return;
    temporizador = setTimeout(async () => {
      temporizador = null;
      await ejecutar();
      programar();
    }, intervaloMs);
    // El temporizador no debe ser lo unico que mantenga vivo el proceso.
    temporizador.unref?.();
  }

  return {
    iniciar() {
      if (activo) return;
      activo = true;
      programar();
    },
    /** Para el ciclo y espera al que este en curso (apagado ordenado: antes de cerrar el pool). */
    async detener() {
      activo = false;
      if (temporizador) clearTimeout(temporizador);
      temporizador = null;
      if (enCurso) await enCurso;
    },
    ejecutar,
  };
}
