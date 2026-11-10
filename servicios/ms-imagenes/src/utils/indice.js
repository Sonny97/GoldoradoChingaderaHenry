/**
 * Indice en memoria: (entidad, idEntidad) -> imagenes, la mas reciente primero.
 *
 * Es lo que hace que BuscarImagenes responda en microsegundos: la home pide
 * los escudos de 16 equipos en cada carga y consultar Drive cada vez (100
 * unidades de cuota por files.list, ~200 ms) no tiene sentido para datos que
 * cambian una vez al mes. Lo usan los dos almacenes (local y Drive).
 *
 * "Vigente" = la de creadoEn mas reciente; a igual fecha gana la que se
 * agrego despues (dos subidas en el mismo milisegundo al correr el setup).
 */

export function crearIndice() {
  const porId = new Map();
  /** entidad -> Map(idEntidad -> Imagen[] ordenadas de nueva a vieja) */
  const porEntidad = new Map();

  function lista(entidad, idEntidad, crear = false) {
    let ids = porEntidad.get(entidad);
    if (!ids) {
      if (!crear) return undefined;
      ids = new Map();
      porEntidad.set(entidad, ids);
    }
    let imagenes = ids.get(idEntidad);
    if (!imagenes && crear) {
      imagenes = [];
      ids.set(idEntidad, imagenes);
    }
    return imagenes;
  }

  function quitar(id) {
    const imagen = porId.get(id);
    if (!imagen) return false;
    porId.delete(id);
    const imagenes = lista(imagen.entidad, imagen.idEntidad);
    if (imagenes) {
      const i = imagenes.findIndex((x) => x.id === id);
      if (i >= 0) imagenes.splice(i, 1);
      if (imagenes.length === 0) porEntidad.get(imagen.entidad).delete(imagen.idEntidad);
    }
    return true;
  }

  function agregar(imagen) {
    quitar(imagen.id);
    porId.set(imagen.id, imagen);
    const imagenes = lista(imagen.entidad, imagen.idEntidad, true);
    const i = imagenes.findIndex((x) => String(x.creadoEn) <= String(imagen.creadoEn));
    if (i < 0) imagenes.push(imagen);
    else imagenes.splice(i, 0, imagen);
  }

  return {
    agregar,
    quitar,
    obtener: (id) => porId.get(id),
    /** Todas las imagenes de una entidad concreta (para reemplazar). */
    deEntidad: (entidad, idEntidad) => [...(lista(entidad, String(idEntidad)) ?? [])],
    /**
     * La vigente de cada idEntidad pedido; ids vacio = todas las de esa entidad.
     * @returns {object[]}
     */
    buscar(entidad, idsEntidad = []) {
      const ids = porEntidad.get(entidad);
      if (!ids) return [];
      if (idsEntidad.length === 0) return [...ids.values()].map((imagenes) => imagenes[0]);
      return idsEntidad.map((id) => ids.get(String(id))?.[0]).filter(Boolean);
    },
    todas: () => [...porId.values()],
    vaciar() {
      porId.clear();
      porEntidad.clear();
    },
    get tamano() {
      return porId.size;
    },
  };
}
