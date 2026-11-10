/**
 * Las consultas `q` de la API de Drive: el "SQL" de este servicio.
 *
 * Drive no tiene tablas: cada archivo lleva sus appProperties (privadas de
 * esta app) y se filtra con `appProperties has { key='k' and value='v' }`.
 * TODO valor que viene de afuera pasa por escaparQ: dentro de las comillas
 * simples de `q`, la comilla se escribe \' y la barra invertida \\. Sin eso,
 * un idEntidad como  x' or name contains '  cambiaria la consulta (inyeccion,
 * igual que en SQL). Documentadas con su equivalente REST en db/03_consultas.md.
 */

export const APP = 'goldorado';
export const MIME_CARPETA = 'application/vnd.google-apps.folder';
export const NOMBRE_RAIZ = 'GolDorado - Imagenes';

/** Campos que se piden de cada archivo (Drive devuelve solo lo que se pide). */
export const CAMPOS_ARCHIVO =
  'id,name,mimeType,size,createdTime,modifiedTime,description,appProperties,parents,trashed';

export function escaparQ(valor) {
  return String(valor).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function tienePropiedad(clave, valor) {
  return `appProperties has { key='${escaparQ(clave)}' and value='${escaparQ(valor)}' }`;
}

const y = (...partes) => partes.join(' and ');
const noCarpeta = `mimeType != '${MIME_CARPETA}'`;
const esCarpeta = `mimeType = '${MIME_CARPETA}'`;
const vigente = 'trashed = false';

export const consultas = {
  /** Todas las imagenes de la app (lo que construye el indice). */
  imagenesApp: () => y(tienePropiedad('app', APP), noCarpeta, vigente),
  /** Todas las de una entidad: los escudos de todos los equipos. */
  imagenesDeEntidad: (entidad) => y(tienePropiedad('app', APP), tienePropiedad('entidad', entidad), noCarpeta, vigente),
  /** Las de UNA entidad concreta: la foto de perfil del usuario 7. */
  imagenesDe: (entidad, idEntidad) =>
    y(
      tienePropiedad('app', APP),
      tienePropiedad('entidad', entidad),
      tienePropiedad('idEntidad', idEntidad),
      noCarpeta,
      vigente
    ),
  /** La carpeta raiz "GolDorado - Imagenes" creada por la app. */
  raiz: () => y(tienePropiedad('app', APP), tienePropiedad('tipo', 'raiz'), esCarpeta, vigente),
  /** La subcarpeta de una entidad dentro de la raiz ('<id>' in parents = padre DIRECTO). */
  subcarpeta: (raizId, entidad) =>
    y(
      `'${escaparQ(raizId)}' in parents`,
      tienePropiedad('app', APP),
      tienePropiedad('tipo', 'carpeta'),
      tienePropiedad('entidad', entidad),
      esCarpeta,
      vigente
    ),
};
