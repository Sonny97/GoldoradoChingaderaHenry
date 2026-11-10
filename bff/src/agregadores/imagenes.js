/**
 * Busqueda de imagenes como dato SECUNDARIO.
 *
 * Escudos, fotos de perfil y banners de promociones adornan una respuesta pero
 * no la sostienen: si ms-imagenes (o Drive) no responde, el frontend cae al
 * escudo generado por CSS del monolito. Por eso esta busqueda nunca lanza:
 * ante cualquier fallo devuelve un mapa vacio y deja un aviso en el log.
 */

import { indicePorEntidad } from '../mapeadores/imagenes.js';
import { opciones } from '../utils/contexto.js';

export function crearBuscadorImagenes({ clientes, log }) {
  /** Peticion gRPC (promesa) para una entidad y sus ids. */
  function pedir(entidad, ids, req) {
    const unicos = [...new Set(ids.filter((id) => id !== null && id !== undefined).map(String))];
    if (unicos.length === 0) return Promise.resolve({ imagenes: [] });
    return clientes.imagenes.BuscarImagenes({ entidad, idsEntidad: unicos }, opciones(req));
  }

  /** Convierte el resultado de Promise.allSettled en Map idEntidad -> url. */
  function aIndice(resultado, descripcion) {
    if (resultado.status === 'fulfilled') return indicePorEntidad(resultado.value?.imagenes ?? []);
    log.aviso(`${descripcion} fallo (se continua sin imagenes): ${resultado.reason?.details ?? resultado.reason?.message}`);
    return new Map();
  }

  async function urlsPorEntidad(entidad, ids, req) {
    const [resultado] = await Promise.allSettled([pedir(entidad, ids, req)]);
    return aIndice(resultado, `BuscarImagenes(${entidad})`);
  }

  return { pedir, aIndice, urlsPorEntidad };
}
