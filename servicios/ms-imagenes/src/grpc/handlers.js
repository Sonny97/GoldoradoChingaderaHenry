/**
 * RPCs de goldorado.imagenes.Imagenes: traducen request <-> servicio.
 *
 * Las imagenes se mapean CAMPO POR CAMPO al mensaje del .proto: el objeto
 * interno trae subidoPor (auditoria) que no es parte del contrato, y el
 * campo optional `descripcion` se omite cuando esta vacio.
 */

/** Imagen interna -> mensaje Imagen del proto. */
export function aImagenProto(imagen) {
  const mensaje = {
    id: imagen.id,
    nombre: imagen.nombre ?? '',
    tipoMime: imagen.tipoMime ?? '',
    tamanoBytes: Number(imagen.tamanoBytes ?? 0),
    entidad: imagen.entidad ?? '',
    idEntidad: String(imagen.idEntidad ?? ''),
    creadoEn: imagen.creadoEn ?? '',
  };
  if (imagen.descripcion) mensaje.descripcion = imagen.descripcion;
  return mensaje;
}

/**
 * @param {object} o
 * @param {ReturnType<import('../servicios/imagenServicio.js').crearServicioImagenes>} o.imagenes
 * @param {Function} o.salud  crearRpcSalud(...)
 */
export function crearHandlers({ imagenes, salud }) {
  return {
    Salud: () => salud(),

    async SubirImagen(peticion) {
      return aImagenProto(await imagenes.subir(peticion));
    },

    async ObtenerImagen({ id }, ctx) {
      await imagenes.transmitir(id, {
        cancelado: ctx.cancelado,
        escribir: (mensaje) =>
          ctx.escribir(mensaje.metadatos ? { metadatos: aImagenProto(mensaje.metadatos) } : mensaje),
      });
    },

    async ObtenerMetadatos({ id }) {
      return aImagenProto(await imagenes.metadatos(id));
    },

    async BuscarImagenes(peticion) {
      const encontradas = await imagenes.buscar(peticion);
      return { imagenes: encontradas.map(aImagenProto) };
    },

    async EliminarImagen({ id }) {
      await imagenes.eliminar(id);
      return {};
    },
  };
}
