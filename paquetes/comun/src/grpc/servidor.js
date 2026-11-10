/**
 * Servidor gRPC con los handlers envueltos.
 *
 * Cada servicio escribe sus metodos como funciones async normales:
 *
 *   servidor.registrar('deportes', {
 *     async ObtenerEncuentro({ id }) {
 *       const encuentro = await repo.buscar(id);
 *       if (!encuentro) throw noEncontrado('Partido no encontrado');
 *       return encuentro;
 *     },
 *   });
 *
 * y este modulo se encarga de lo que se repetiria en cada uno:
 *   - convertir la promesa en callback(null, respuesta) / callback(error)
 *   - traducir la excepcion a estado gRPC (ver errores.js)
 *   - comprobar el token interno (metadato x-token-interno), si esta configurado
 *   - medir y registrar la duracion de cada llamada (LOG_NIVEL=debug)
 *   - en streaming de servidor: respetar la contrapresion (drain) y detenerse
 *     si el cliente cancela
 *
 * Si falta implementar un metodo del .proto, el servidor NO arranca: es mejor
 * enterarse al iniciar que cuando un usuario llama al metodo.
 */

import grpc from '@grpc/grpc-js';
import { once } from 'node:events';
import { timingSafeEqual } from 'node:crypto';

import { constructorServicio } from './proto.js';
import { aErrorGrpc } from '../errores.js';

const OCHO_MB = 8 * 1024 * 1024;

/** Comparacion en tiempo constante: no revela por tiempos cuanto acerto el token. */
function mismoSecreto(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * @param {object} opciones
 * @param {string} opciones.nombre         'ms-deportes'
 * @param {object} opciones.log            crearLogger(...)
 * @param {string} [opciones.tokenInterno] si viene, toda llamada debe traerlo
 * @param {number} [opciones.maxMensajeBytes]
 */
export function crearServidorGrpc({ nombre, log, tokenInterno = '', maxMensajeBytes = OCHO_MB }) {
  const servidor = new grpc.Server({
    'grpc.max_receive_message_length': maxMensajeBytes,
    'grpc.max_send_message_length': maxMensajeBytes,
  });

  function autorizado(llamada) {
    if (!tokenInterno) return true;
    return mismoSecreto(llamada.metadata.get('x-token-interno')[0], tokenInterno);
  }

  function contexto(llamada) {
    return {
      metadata: llamada.metadata,
      llamada,
      idSolicitud: String(llamada.metadata.get('x-id-solicitud')[0] ?? ''),
      cancelado: () => Boolean(llamada.cancelled),
    };
  }

  function registrarResultado(metodo, inicio, error) {
    const ms = (performance.now() - inicio).toFixed(1);
    if (!error) {
      log.debug(`${metodo} OK ${ms} ms`);
    } else if (error.code === grpc.status.INTERNAL) {
      // aErrorGrpc ya dejo el detalle completo en el log
    } else {
      log.debug(`${metodo} -> ${grpc.status[error.code]} "${error.details}" ${ms} ms`);
    }
  }

  function envolverUnario(metodo, manejador) {
    return async (llamada, callback) => {
      const inicio = performance.now();
      if (!autorizado(llamada)) {
        callback({ code: grpc.status.UNAUTHENTICATED, details: 'Token interno inválido' });
        return;
      }
      try {
        const respuesta = await manejador(llamada.request, contexto(llamada));
        callback(null, respuesta ?? {});
        registrarResultado(metodo, inicio, null);
      } catch (error) {
        const errorGrpc = aErrorGrpc(error, { servicio: nombre, log, metodo });
        callback(errorGrpc);
        registrarResultado(metodo, inicio, errorGrpc);
      }
    };
  }

  function envolverStream(metodo, manejador) {
    return async (llamada) => {
      const inicio = performance.now();
      if (!autorizado(llamada)) {
        llamada.emit('error', { code: grpc.status.UNAUTHENTICATED, details: 'Token interno inválido' });
        return;
      }
      const ctx = contexto(llamada);
      /** write() que espera 'drain' cuando el buffer se llena. */
      ctx.escribir = async (mensaje) => {
        if (llamada.cancelled) return false;
        if (!llamada.write(mensaje)) await once(llamada, 'drain');
        return true;
      };
      try {
        await manejador(llamada.request, ctx);
        if (!llamada.cancelled) llamada.end();
        registrarResultado(metodo, inicio, null);
      } catch (error) {
        const errorGrpc = aErrorGrpc(error, { servicio: nombre, log, metodo });
        if (!llamada.cancelled) llamada.emit('error', errorGrpc);
        registrarResultado(metodo, inicio, errorGrpc);
      }
    };
  }

  /**
   * @param {string} clave  'autenticacion' | 'deportes' | 'apuestas' | ... (ver proto.js)
   * @param {Record<string, Function>} implementacion  metodos con el MISMO nombre del .proto
   */
  function registrar(clave, implementacion) {
    const definicion = constructorServicio(clave).service;
    const faltantes = Object.keys(definicion).filter((m) => typeof implementacion[m] !== 'function');
    if (faltantes.length > 0) {
      throw new Error(`${nombre}: faltan por implementar los RPC ${faltantes.join(', ')}`);
    }

    const envueltos = {};
    for (const [metodo, def] of Object.entries(definicion)) {
      if (def.requestStream) throw new Error(`${metodo}: el streaming de cliente no esta soportado`);
      const manejador = implementacion[metodo].bind(implementacion);
      envueltos[metodo] = def.responseStream
        ? envolverStream(metodo, manejador)
        : envolverUnario(metodo, manejador);
    }
    servidor.addService(definicion, envueltos);
  }

  /** Abre el puerto. En grpc-js >= 1.10 bindAsync ya arranca: no hace falta start(). */
  function iniciar(puerto, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      servidor.bindAsync(`${host}:${puerto}`, grpc.ServerCredentials.createInsecure(), (error, real) =>
        error ? reject(error) : resolve(real)
      );
    });
  }

  /** Deja terminar las llamadas en curso; si tardan mas de `ms`, corta. */
  function apagar(ms = 5000) {
    return new Promise((resolve) => {
      const salvavidas = setTimeout(() => {
        servidor.forceShutdown();
        resolve();
      }, ms);
      salvavidas.unref();
      servidor.tryShutdown(() => {
        clearTimeout(salvavidas);
        resolve();
      });
    });
  }

  return { servidor, registrar, iniciar, apagar };
}
