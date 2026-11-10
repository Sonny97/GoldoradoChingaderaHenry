/**
 * Imagen de ms-imagenes (proto) -> forma REST.
 *
 * El navegador nunca ve el id de Drive como URL de Google: ve /api/imagenes/<id>
 * y el BFF hace de puente (streaming gRPC -> HTTP). Asi la carpeta de Drive no
 * necesita ser publica y las cabeceras de seguridad las pone el BFF.
 */

export const urlImagen = (id) => (id ? `/api/imagenes/${encodeURIComponent(id)}` : null);

export function aImage(imagen) {
  if (!imagen) return null;
  return {
    id: imagen.id,
    url: urlImagen(imagen.id),
    name: imagen.nombre,
    mimeType: imagen.tipoMime,
    size: Number(imagen.tamanoBytes ?? 0),
    entity: imagen.entidad,
    entityId: imagen.idEntidad,
    description: imagen.descripcion ?? null,
    createdAt: imagen.creadoEn || null,
  };
}

/**
 * idEntidad -> url de la imagen MAS RECIENTE de esa entidad. Si un admin subio
 * dos escudos para el mismo equipo, gana el ultimo.
 */
export function indicePorEntidad(imagenes = []) {
  const recientes = new Map();
  for (const imagen of imagenes) {
    const clave = String(imagen.idEntidad);
    const actual = recientes.get(clave);
    if (!actual || String(imagen.creadoEn ?? '') > String(actual.creadoEn ?? '')) {
      recientes.set(clave, imagen);
    }
  }
  const urls = new Map();
  for (const [clave, imagen] of recientes) urls.set(clave, urlImagen(imagen.id));
  return urls;
}
