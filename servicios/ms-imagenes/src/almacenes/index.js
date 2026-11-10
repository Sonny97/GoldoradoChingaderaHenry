/**
 * Elige el almacen segun IMAGENES_ALMACEN (drive | local).
 *
 * Los dos cumplen la MISMA interfaz, asi el servicio no sabe donde viven los
 * bytes (en el monolito, la capa de repositorios cumplia ese papel):
 *
 *   modo, descripcion                       para Salud
 *   iniciar()                               carga el indice (no bloquea el arranque)
 *   preparar()                              carpetas (db:setup)
 *   guardar({ entidad, idEntidad, nombre, tipoMime, contenido, descripcion, subidoPor }) -> Imagen
 *   metadatos(id)                           -> Imagen | null
 *   abrir(id)                               -> AsyncIterable<Buffer> | null
 *   buscar(entidad, idsEntidad)             -> Imagen[] (la vigente de cada id, desde el indice)
 *   imagenesDe(entidad, idEntidad)          -> Imagen[] (todas, para reemplazar)
 *   eliminar(id)                            -> boolean
 *   comprobar()                             lanza si el almacen no responde
 *   cerrar()
 */

import { isAbsolute, resolve } from 'node:path';
import { raizDelPaquete } from '@goldorado/comun';

import { crearClienteDrive } from './clienteDrive.js';
import { crearAlmacenDrive } from './drive.js';
import { crearAlmacenLocal } from './local.js';

const RAIZ_SERVICIO = raizDelPaquete(import.meta.url);

/** Rutas relativas del .env se resuelven contra la carpeta del servicio, no contra el cwd. */
export function rutaDelServicio(ruta) {
  return isAbsolute(ruta) ? ruta : resolve(RAIZ_SERVICIO, ruta);
}

export function crearAlmacen({ env, log }) {
  if (env.IMAGENES_ALMACEN !== 'drive') {
    return crearAlmacenLocal({ dir: rutaDelServicio(env.IMAGENES_DIR_LOCAL), log });
  }
  return crearAlmacenDrive({
    autenticacion: env.DRIVE_AUTENTICACION,
    obtenerDrive: () =>
      crearClienteDrive({
        autenticacion: env.DRIVE_AUTENTICACION,
        clientId: env.DRIVE_OAUTH_CLIENT_ID,
        clientSecret: env.DRIVE_OAUTH_CLIENT_SECRET,
        refreshToken: env.DRIVE_OAUTH_REFRESH_TOKEN,
        rutaCredenciales: rutaDelServicio(env.GOOGLE_DRIVE_CREDENCIALES),
      }),
    unidadCompartidaId: env.DRIVE_UNIDAD_COMPARTIDA_ID,
    carpetaRaizId: env.DRIVE_CARPETA_RAIZ_ID,
    cacheBytes: env.IMAGENES_CACHE_BYTES,
    refrescoMs: env.DRIVE_INDICE_REFRESCO_MS,
    log,
  });
}
