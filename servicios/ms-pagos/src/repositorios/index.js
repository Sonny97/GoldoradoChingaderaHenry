/**
 * Elige el almacen segun PAGOS_ALMACEN: Firestore (el del tablero) o memoria
 * (desarrollo sin nube). El import de Firestore es dinamico para que el modo
 * memoria ni siquiera cargue firebase-admin.
 */

import { crearRepoPagosMemoria } from './pagoRepoMemoria.js';

/**
 * @param {Record<string, any>} env
 * @returns {Promise<{ repo: object, baseDatos: string, descripcion: string, error: Error|null,
 *                     comprobar: () => Promise<any>, cerrar: () => Promise<void> }>}
 */
export async function crearAlmacen(env) {
  if (env.PAGOS_ALMACEN === 'memoria') {
    const repo = crearRepoPagosMemoria();
    return {
      repo,
      baseDatos: 'memoria',
      descripcion: 'memoria (se pierde al reiniciar; trae GD-SEED-0001 y GD-SEED-0002)',
      error: null,
      comprobar: () => repo.comprobar(),
      cerrar: async () => {},
    };
  }

  const { abrirFirestore } = await import('../config/firestore.js');
  const { crearRepoPagosFirestore } = await import('./pagoRepoFirestore.js');
  const conexion = abrirFirestore(env);
  // Sin credenciales validas el repo igual existe: cada operacion falla con el
  // mismo motivo que muestra Salud.
  const repo = conexion.db ? crearRepoPagosFirestore(conexion.db) : repoSinConexion(conexion.error);
  return {
    repo,
    baseDatos: conexion.proyecto,
    descripcion: `Firestore ${conexion.proyecto}${conexion.origen ? ` via ${conexion.origen}` : ''}`,
    error: conexion.error,
    comprobar: () => conexion.comprobar(),
    cerrar: () => conexion.cerrar(),
  };
}

function repoSinConexion(error) {
  const fallar = async () => {
    throw error;
  };
  return new Proxy(
    { almacen: 'firestore' },
    { get: (objetivo, clave) => (clave in objetivo ? objetivo[clave] : clave === 'then' ? undefined : fallar) }
  );
}
