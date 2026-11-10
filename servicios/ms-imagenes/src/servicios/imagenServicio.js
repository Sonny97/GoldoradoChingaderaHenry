/**
 * Reglas de las imagenes: que se acepta, como se reemplaza, como se envia.
 *
 * No sabe si los bytes viven en Drive o en disco (recibe el almacen ya
 * creado). Lanza ErrorNegocio con mensajes en español listos para el usuario.
 *
 * REEMPLAZAR (fotos de perfil): primero se sube la nueva y SOLO si eso
 * funciono se borran las anteriores. Al reves, un fallo de Drive a mitad
 * dejaria al usuario sin foto. Si borrar una vieja falla, la subida igual
 * cuenta como exitosa (la vigente es la nueva) y queda el aviso en el log.
 */

import { invalido, noEncontrado } from '@goldorado/comun';

import { enTrozos, TAMANO_TROZO } from '../utils/trozos.js';
import { nombreSeguro, validarEntidad, validarSubida } from '../utils/validacion.js';

const ETIQUETAS = {
  equipo: 'Escudo del equipo',
  jugador: 'Foto del jugador',
  estadio: 'Foto del estadio',
  torneo: 'Logo del torneo',
  promocion: 'Banner de la promoción',
  usuario: 'Foto de perfil del usuario',
};

function validarId(id) {
  const valor = String(id ?? '').trim();
  if (!valor) throw invalido('Falta el id de la imagen');
  return valor;
}

/**
 * @param {object} o
 * @param {object} o.almacen   crearAlmacenLocal | crearAlmacenDrive
 * @param {object} o.log
 * @param {number} o.maxBytes  IMAGENES_MAX_BYTES
 */
export function crearServicioImagenes({ almacen, log, maxBytes = 5 * 1024 * 1024 }) {
  async function subir(peticion) {
    const { entidad, idEntidad, tipoMime, contenido } = validarSubida(peticion, { maxBytes });
    const subidoPor = Number(peticion.subidoPor) || 0;
    const descripcion =
      String(peticion.descripcion ?? '').trim().slice(0, 500) ||
      `${ETIQUETAS[entidad]} ${idEntidad}${subidoPor ? ` (subida por el usuario ${subidoPor})` : ''}`;

    // Las anteriores se averiguan ANTES de subir: asi la nueva nunca esta en la lista.
    const anteriores = peticion.reemplazar ? await almacen.imagenesDe(entidad, idEntidad) : [];

    const nueva = await almacen.guardar({
      entidad,
      idEntidad,
      nombre: nombreSeguro(peticion.nombre, { entidad, idEntidad, tipoMime }),
      tipoMime,
      contenido,
      descripcion,
      subidoPor,
    });

    for (const vieja of anteriores) {
      if (vieja.id === nueva.id) continue;
      try {
        await almacen.eliminar(vieja.id);
      } catch (error) {
        log?.aviso?.(`Reemplazar ${entidad} ${idEntidad}: no se pudo borrar la imagen anterior ${vieja.id}: ${error.message}`);
      }
    }
    return nueva;
  }

  async function metadatos(id) {
    const imagen = await almacen.metadatos(validarId(id));
    if (!imagen) throw noEncontrado('Imagen no encontrada');
    return imagen;
  }

  /**
   * Streaming: primero { metadatos }, luego { trozo } de 64 KB.
   * El flujo se abre ANTES de escribir nada: si el archivo no existe, el
   * cliente recibe un NOT_FOUND limpio y no un stream a medias.
   */
  async function transmitir(id, ctx) {
    const imagen = await metadatos(id);
    const flujo = await almacen.abrir(imagen.id);
    if (!flujo) throw noEncontrado('Imagen no encontrada');

    const trozos = enTrozos(flujo, TAMANO_TROZO);
    try {
      if (!(await ctx.escribir({ metadatos: imagen }))) return;
      for await (const trozo of trozos) {
        if (ctx.cancelado()) break;
        if (!(await ctx.escribir({ trozo }))) break;
      }
    } finally {
      // Cierra el archivo / la descarga de Drive si se corto antes del final
      // (despues de un envio completo no hace nada).
      await trozos.return?.().catch(() => {});
      flujo.destroy?.();
    }
  }

  async function buscar({ entidad, idsEntidad = [] }) {
    const e = validarEntidad(entidad);
    const ids = [...new Set((idsEntidad ?? []).map((v) => String(v).trim()).filter(Boolean))];
    return almacen.buscar(e, ids);
  }

  async function eliminar(id) {
    const borrada = await almacen.eliminar(validarId(id));
    if (!borrada) throw noEncontrado('Imagen no encontrada');
  }

  return { subir, metadatos, transmitir, buscar, eliminar };
}
