/**
 * Validacion de lo que se sube: entidad, tipo, tamaño y CONTENIDO.
 *
 * El tipo_mime lo declara el cliente y no prueba nada: un .exe renombrado a
 * .png llega como image/png. Por eso se revisan los "numeros magicos" (los
 * primeros bytes de cada formato) y deben coincidir con el tipo declarado.
 *
 * El SVG es texto XML y puede traer JavaScript: si alguien abre la URL de la
 * imagen directamente (no dentro de un <img>), el navegador lo ejecutaria con
 * el origen del BFF. Se rechaza todo lo que pueda ejecutar codigo o cargar
 * recursos externos: <script>, manejadores on*=, URLs javascript:, href que
 * no sea un #fragmento, url(...) externos, <foreignObject> y DOCTYPE/ENTITY.
 */

import { invalido } from '@goldorado/comun';

export const ENTIDADES = Object.freeze(['equipo', 'jugador', 'estadio', 'torneo', 'promocion', 'usuario']);

/** tipo MIME -> nombre corto para los mensajes y extension del archivo. */
export const TIPOS = Object.freeze({
  'image/png': { nombre: 'PNG', extension: 'png' },
  'image/jpeg': { nombre: 'JPEG', extension: 'jpg' },
  'image/webp': { nombre: 'WEBP', extension: 'webp' },
  'image/svg+xml': { nombre: 'SVG', extension: 'svg' },
});

/** Alias que mandan algunos navegadores/herramientas. */
const ALIAS = { 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/svg': 'image/svg+xml' };

// appProperties: 124 bytes por propiedad (clave + valor, UTF-8). 'idEntidad'
// ocupa 9, asi que 100 deja margen de sobra.
const MAX_BYTES_ID_ENTIDAD = 100;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function validarEntidad(entidad) {
  const valor = String(entidad ?? '').trim().toLowerCase();
  if (!ENTIDADES.includes(valor)) {
    throw invalido(`Entidad no válida: usa ${ENTIDADES.slice(0, -1).join(', ')} o ${ENTIDADES.at(-1)}`);
  }
  return valor;
}

export function validarIdEntidad(idEntidad) {
  const valor = String(idEntidad ?? '').trim();
  if (!valor) throw invalido('Falta el id de la entidad');
  if (Buffer.byteLength(valor, 'utf8') > MAX_BYTES_ID_ENTIDAD) throw invalido('El id de la entidad es demasiado largo');
  return valor;
}

/** 'IMAGE/JPG; charset=x' -> 'image/jpeg'. Lanza si no es uno de los 4 tipos. */
export function normalizarTipo(tipoMime) {
  const base = String(tipoMime ?? '').split(';')[0].trim().toLowerCase();
  const tipo = ALIAS[base] ?? base;
  if (!TIPOS[tipo]) throw invalido('Solo se aceptan imágenes PNG, JPEG, WEBP o SVG');
  return tipo;
}

function textoMb(bytes) {
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb} MB`;
}

// --------------------------------------------------------------- formatos
export function esPng(b) {
  return b.length >= FIRMA_PNG.length && b.subarray(0, FIRMA_PNG.length).equals(FIRMA_PNG);
}
export function esJpeg(b) {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
export function esWebp(b) {
  return b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}

/** Texto UTF-8 estricto (sin BOM) o null si los bytes no son UTF-8 valido. */
function comoUtf8(b) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b);
  } catch {
    return null;
  }
}

/** Resuelve &#106; / &#x6A; para que "&#106;avascript:" no pase el filtro. */
function sinEntidadesNumericas(texto) {
  return texto
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)));
}

export function esSvg(b) {
  const texto = comoUtf8(b);
  if (texto === null || texto.includes('\u0000')) return false;
  return /<svg[\s>/]/i.test(texto);
}

/**
 * Motivo por el que un SVG se rechaza, o null si es seguro.
 * Se analiza el texto con las entidades numericas ya resueltas.
 */
export function motivoSvgInseguro(b) {
  const crudo = comoUtf8(b) ?? '';
  const texto = sinEntidadesNumericas(crudo);
  const reglas = [
    [/<\s*script[\s>/]/i, 'contiene <script>'],
    [/[\s"'/]on[a-z]+\s*=/i, 'contiene manejadores de eventos (on...=)'],
    [/javascript\s*:/i, 'contiene URLs javascript:'],
    [/<!DOCTYPE|<!ENTITY/i, 'declara DOCTYPE/ENTITY'],
    [/<\s*(foreignObject|iframe|embed|object)[\s>/]/i, 'incrusta HTML (foreignObject/iframe/embed/object)'],
    [/@import/i, 'importa hojas de estilo externas'],
    [/url\(\s*(?!['"]?\s*#)/i, 'carga recursos externos con url(...)'],
  ];
  for (const [patron, motivo] of reglas) {
    if (patron.test(texto)) return motivo;
  }
  // href / xlink:href: solo referencias internas (#id). Con o sin comillas.
  const hrefs = texto.matchAll(/(?:^|[\s"'])(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
  for (const m of hrefs) {
    const destino = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!destino.startsWith('#')) return 'referencia recursos externos (href)';
  }
  return null;
}

const DETECTORES = {
  'image/png': esPng,
  'image/jpeg': esJpeg,
  'image/webp': esWebp,
  'image/svg+xml': esSvg,
};

/**
 * Valida una subida completa. Devuelve los valores normalizados.
 * Orden: entidad -> id -> tipo -> vacio -> tamaño -> bytes -> SVG seguro.
 */
export function validarSubida({ entidad, idEntidad, tipoMime, contenido }, { maxBytes }) {
  const e = validarEntidad(entidad);
  const id = validarIdEntidad(idEntidad);
  const tipo = normalizarTipo(tipoMime);
  const bytes = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido ?? []);

  if (bytes.length === 0) throw invalido('La imagen está vacía');
  if (bytes.length > maxBytes) throw invalido(`La imagen supera ${textoMb(maxBytes)}`);
  if (!DETECTORES[tipo](bytes)) {
    throw invalido(`El contenido no corresponde a una imagen ${TIPOS[tipo].nombre} válida`);
  }
  if (tipo === 'image/svg+xml') {
    const motivo = motivoSvgInseguro(bytes);
    if (motivo) throw invalido('El SVG contiene código no permitido', { motivo });
  }
  return { entidad: e, idEntidad: id, tipoMime: tipo, contenido: bytes };
}

/**
 * Nombre de archivo presentable: sin rutas, sin caracteres de control, con
 * tope de largo. Si no viene, se arma con la entidad y su id.
 */
export function nombreSeguro(nombre, { entidad, idEntidad, tipoMime }) {
  const limpio = String(nombre ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .trim()
    .slice(0, 120);
  return limpio || `${entidad}-${idEntidad}.${TIPOS[tipoMime].extension}`;
}
