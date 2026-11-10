/**
 * Elige la pasarela segun WOMPI_MODO. Las dos implementaciones exponen la
 * misma interfaz, asi pagoServicio no sabe (ni le importa) si habla con Wompi
 * de verdad o con el simulador.
 */

import { crearClienteWompi } from './cliente.js';
import { crearPasarelaSimulada } from './simulado.js';

/** Variables que el modo real necesita; si faltan, index.js lo avisa al arrancar. */
export function llavesFaltantes(env) {
  if (env.WOMPI_MODO === 'simulado') return [];
  return ['WOMPI_LLAVE_PUBLICA', 'WOMPI_LLAVE_PRIVADA', 'WOMPI_SECRETO_EVENTOS', 'WOMPI_SECRETO_INTEGRIDAD'].filter(
    (clave) => !env[clave]
  );
}

/**
 * @param {Record<string, any>} env
 * @param {{ repo: { obtener: Function }, log: object }} deps
 */
export function crearPasarela(env, { repo, log }) {
  if (env.WOMPI_MODO === 'simulado') {
    return crearPasarelaSimulada({ obtenerPago: (referencia) => repo.obtener(referencia) });
  }
  return crearClienteWompi({
    modo: env.WOMPI_MODO,
    llavePublica: env.WOMPI_LLAVE_PUBLICA,
    llavePrivada: env.WOMPI_LLAVE_PRIVADA,
    secretoIntegridad: env.WOMPI_SECRETO_INTEGRIDAD,
    plazoMs: env.WOMPI_PLAZO_MS,
    log,
  });
}
