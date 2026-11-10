/**
 * RPC `Salud` comun a todos los servicios, y arranque/apagado ordenado.
 *
 * Salud NO lanza cuando la base esta caida: responde estado 'error' con el
 * detalle. Es lo primero que hay que mirar cuando "no carga nada", y tiene que
 * poder decir QUE esta fallando (GET /api/salud en el BFF junta las seis).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { raizDelPaquete } from './env.js';

/** Rechaza si la promesa tarda mas de `ms`. */
export function conTiempoLimite(promesa, ms, mensaje = `Sin respuesta en ${ms} ms`) {
  let temporizador;
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(() => reject(new Error(mensaje)), ms);
  });
  return Promise.race([Promise.resolve(promesa), limite]).finally(() => clearTimeout(temporizador));
}

/** Version del package.json del servicio que llama. */
export function versionDelPaquete(urlArchivo) {
  try {
    const raiz = raizDelPaquete(urlArchivo);
    return JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Construye el handler del RPC Salud.
 *
 * @param {object} o
 * @param {string} o.servicio            'ms-deportes'
 * @param {string} o.motor               'MySQL'
 * @param {string|Function} o.baseDatos  nombre de la base (o funcion que lo devuelve)
 * @param {string|Function} [o.modo]     modo de almacenamiento
 * @param {string} o.version
 * @param {() => Promise<any>} o.comprobar  consulta trivial contra la base (SELECT 1, ping...)
 */
export function crearRpcSalud({ servicio, motor, baseDatos, modo = '', version = '0.0.0', comprobar, plazoMs = 2500 }) {
  const arranque = Date.now();
  const valor = (v) => (typeof v === 'function' ? v() : v);

  return async function Salud() {
    let estado = 'ok';
    let detalle = '';
    try {
      await conTiempoLimite(comprobar(), plazoMs, `La base no respondio en ${plazoMs} ms`);
    } catch (error) {
      estado = 'error';
      detalle = error?.message ?? String(error);
    }
    return {
      servicio,
      estado,
      motor,
      baseDatos: String(valor(baseDatos) ?? ''),
      detalle,
      version,
      tiempoActivoSeg: Math.round((Date.now() - arranque) / 100) / 10,
      modo: String(valor(modo) ?? ''),
    };
  };
}

/**
 * Cierre ordenado con Ctrl+C / SIGTERM.
 *
 * Sin esto, cada reinicio de nodemon deja conexiones abiertas del lado de la
 * base, que tardan en liberarse; reiniciando muchas veces se agota el limite.
 * El salvavidas corta a los 6 s si algo se queda colgado.
 *
 * @param {object} o
 * @param {object} o.log
 * @param {Array<() => Promise<void>>} o.tareas  en orden: primero el servidor, luego la base
 */
export function apagadoOrdenado({ log, tareas }) {
  let cerrando = false;

  async function apagar(senal) {
    if (cerrando) return;
    cerrando = true;
    log.info(`${senal} recibido, cerrando...`);
    const salvavidas = setTimeout(() => process.exit(1), 6000);
    salvavidas.unref();
    for (const tarea of tareas) {
      try {
        await tarea();
      } catch (error) {
        log.aviso(`Error al cerrar: ${error?.message ?? error}`);
      }
    }
    log.info('Cerrado correctamente.');
    process.exit(0);
  }

  process.on('SIGINT', () => apagar('SIGINT'));
  process.on('SIGTERM', () => apagar('SIGTERM'));
  return apagar;
}
