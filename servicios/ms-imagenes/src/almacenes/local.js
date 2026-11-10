/**
 * Almacen LOCAL: las imagenes en disco, con la misma interfaz que Drive.
 *
 *   <dir>/archivos/<id>.<ext>   los bytes
 *   <dir>/indice.json           los metadatos de todas (lo que en Drive son
 *                               las appProperties de cada archivo)
 *
 * El indice se escribe de forma ATOMICA (archivo temporal + rename): si el
 * proceso muere a mitad de la escritura queda el indice anterior completo,
 * nunca un JSON cortado. Las escrituras se encadenan en una promesa para que
 * dos subidas simultaneas no se pisen. Los ids son 16 bytes aleatorios en
 * hex, y SOLO se aceptan con ese formato: un id como "..\\..\\.env" nunca
 * llega a convertirse en una ruta.
 */

import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as dormir } from 'node:timers/promises';

import { crearIndice } from '../utils/indice.js';
import { TAMANO_TROZO } from '../utils/trozos.js';
import { TIPOS } from '../utils/validacion.js';

const FORMATO_ID = /^[0-9a-f]{32}$/;
const VERSION_INDICE = 1;

/**
 * rename() en Windows falla con EPERM/EBUSY si un antivirus o el indexador
 * tiene el archivo abierto un instante. Unos reintentos cortos lo resuelven.
 */
async function renombrarConReintentos(origen, destino) {
  for (let intento = 0; ; intento += 1) {
    try {
      await rename(origen, destino);
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || intento >= 5) throw error;
      await dormir(20 * (intento + 1));
    }
  }
}

async function escribirAtomico(ruta, contenido) {
  const temporal = `${ruta}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(temporal, contenido);
    await renombrarConReintentos(temporal, ruta);
  } catch (error) {
    await rm(temporal, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * @param {object} o
 * @param {string} o.dir   carpeta absoluta del almacen
 * @param {object} o.log
 */
export function crearAlmacenLocal({ dir, log }) {
  const dirArchivos = join(dir, 'archivos');
  const rutaIndice = join(dir, 'indice.json');
  const indice = crearIndice();
  let cola = Promise.resolve();
  let cargado = null;

  const rutaArchivo = (imagen) => join(dirArchivos, `${imagen.id}.${TIPOS[imagen.tipoMime]?.extension ?? 'bin'}`);

  /** Serializa las escrituras del indice (y lo que las acompaña). */
  function enCola(tarea) {
    const resultado = cola.then(tarea);
    cola = resultado.catch(() => {});
    return resultado;
  }

  async function guardarIndice() {
    const imagenes = Object.fromEntries(indice.todas().map((i) => [i.id, i]));
    await escribirAtomico(rutaIndice, JSON.stringify({ version: VERSION_INDICE, imagenes }, null, 2));
  }

  async function cargar() {
    await mkdir(dirArchivos, { recursive: true });
    let texto;
    try {
      texto = await readFile(rutaIndice, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { imagenes: 0 };
      throw error;
    }
    try {
      const datos = JSON.parse(texto);
      indice.vaciar();
      for (const imagen of Object.values(datos?.imagenes ?? {})) {
        if (imagen && FORMATO_ID.test(imagen.id)) indice.agregar(imagen);
      }
    } catch {
      // Un indice ilegible no se borra: se aparta para revisarlo a mano.
      const apartado = `${rutaIndice}.corrupto-${Date.now()}`;
      await renombrarConReintentos(rutaIndice, apartado).catch(() => {});
      log?.aviso?.(`indice.json ilegible: se aparto como ${apartado} y se empieza con un indice vacio`);
      indice.vaciar();
    }
    return { imagenes: indice.tamano };
  }

  /** Carga una sola vez (iniciar y la primera operacion comparten la promesa). */
  function listo() {
    cargado ??= cargar().catch((error) => {
      cargado = null; // que el proximo intento vuelva a probar
      throw error;
    });
    return cargado;
  }

  return {
    modo: 'local',
    descripcion: dir,

    iniciar: listo,

    async preparar() {
      await listo();
      return { dir };
    },

    async guardar({ entidad, idEntidad, nombre, tipoMime, contenido, descripcion, subidoPor }) {
      await listo();
      const imagen = {
        id: randomBytes(16).toString('hex'),
        nombre,
        tipoMime,
        tamanoBytes: contenido.length,
        entidad,
        idEntidad,
        creadoEn: new Date().toISOString(),
        descripcion: descripcion ?? '',
        subidoPor: Number(subidoPor) || 0,
      };
      return enCola(async () => {
        await escribirAtomico(rutaArchivo(imagen), contenido);
        indice.agregar(imagen);
        try {
          await guardarIndice();
        } catch (error) {
          indice.quitar(imagen.id);
          await unlink(rutaArchivo(imagen)).catch(() => {});
          throw error;
        }
        return { ...imagen };
      });
    },

    async metadatos(id) {
      await listo();
      if (!FORMATO_ID.test(String(id))) return null;
      const imagen = indice.obtener(id);
      return imagen ? { ...imagen } : null;
    },

    /** Flujo de bytes, o null si no existe (el indice o el archivo). */
    async abrir(id) {
      await listo();
      if (!FORMATO_ID.test(String(id))) return null;
      const imagen = indice.obtener(id);
      if (!imagen) return null;
      const ruta = rutaArchivo(imagen);
      try {
        await stat(ruta);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          log?.aviso?.(`La imagen ${id} esta en el indice pero falta su archivo ${ruta}`);
          return null;
        }
        throw error;
      }
      return createReadStream(ruta, { highWaterMark: TAMANO_TROZO });
    },

    async buscar(entidad, idsEntidad) {
      await listo();
      return indice.buscar(entidad, idsEntidad).map((i) => ({ ...i }));
    },

    async imagenesDe(entidad, idEntidad) {
      await listo();
      return indice.deEntidad(entidad, idEntidad).map((i) => ({ ...i }));
    },

    async eliminar(id) {
      await listo();
      if (!FORMATO_ID.test(String(id))) return false;
      return enCola(async () => {
        const imagen = indice.obtener(id);
        if (!imagen) return false;
        indice.quitar(id);
        try {
          await guardarIndice();
        } catch (error) {
          indice.agregar(imagen);
          throw error;
        }
        // Local no tiene papelera: se borra del todo (es solo para desarrollar).
        await unlink(rutaArchivo(imagen)).catch((error) => {
          if (error?.code !== 'ENOENT') log?.aviso?.(`No se pudo borrar ${rutaArchivo(imagen)}: ${error.message}`);
        });
        return true;
      });
    },

    /** Salud: la carpeta existe y se puede escribir en ella. */
    async comprobar() {
      await mkdir(dirArchivos, { recursive: true });
      const prueba = join(dir, `.salud-${process.pid}-${randomBytes(3).toString('hex')}`);
      await writeFile(prueba, 'ok');
      await unlink(prueba);
      await listo();
    },

    async cerrar() {
      await cola;
    },

    get cantidad() {
      return indice.tamano;
    },
  };
}
