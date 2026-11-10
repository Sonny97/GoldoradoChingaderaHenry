/**
 * Firmas de Wompi: funciones PURAS (sin red, sin estado), probadas con los
 * vectores de docs/WOMPI.md.
 *
 * - firmaIntegridad: SHA-256 de referencia + centavos + moneda [+ expiracion]
 *   + secreto de integridad. Se calcula SIEMPRE aqui, en el servidor: si el
 *   navegador la calculara, tendria el secreto y podria cambiar el monto.
 * - checksumEvento / eventoValido: el checksum de un webhook se arma con las
 *   rutas que el propio evento declara en signature.properties (resueltas
 *   dentro de `data`). No se fijan en el codigo porque Wompi puede cambiarlas.
 *   La documentacion muestra el hex en MAYUSCULAS: la comparacion las ignora y
 *   es de tiempo constante (timingSafeEqual) para no filtrar el valor esperado.
 * - urlCheckout: la URL firmada del Web Checkout.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const URL_CHECKOUT = 'https://checkout.wompi.co/p/';

export const sha256Hex = (texto) => createHash('sha256').update(texto, 'utf8').digest('hex');

/**
 * @param {{ referencia: string, montoCentavos: number, moneda?: string, fechaExpiracion?: string }} datos
 * @param {string} secretoIntegridad
 */
export function firmaIntegridad({ referencia, montoCentavos, moneda = 'COP', fechaExpiracion }, secretoIntegridad) {
  return sha256Hex(`${referencia}${montoCentavos}${moneda}${fechaExpiracion ?? ''}${secretoIntegridad}`);
}

/** Lee 'transaction.amount_in_cents' dentro de un objeto sin romperse con nulos. */
function valorEnRuta(raiz, ruta) {
  return String(ruta)
    .split('.')
    .reduce((objeto, clave) => (objeto === null || objeto === undefined ? undefined : objeto[clave]), raiz);
}

/** Checksum esperado de un evento (hex en minuscula). */
export function checksumEvento(evento, secretoEventos) {
  const propiedades = Array.isArray(evento?.signature?.properties) ? evento.signature.properties : [];
  const valores = propiedades
    .map((ruta) => valorEnRuta(evento?.data, ruta))
    .map((valor) => (valor === null || valor === undefined ? '' : String(valor)));
  return sha256Hex(valores.join('') + String(evento?.timestamp ?? '') + secretoEventos);
}

/**
 * true si el checksum recibido (cabecera X-Event-Checksum o, si no vino,
 * signature.checksum) coincide con el calculado.
 */
export function eventoValido(evento, secretoEventos, checksumCabecera) {
  if (!secretoEventos) return false;
  const recibido = String(checksumCabecera || evento?.signature?.checksum || '')
    .trim()
    .toLowerCase();
  const esperado = checksumEvento(evento, secretoEventos);
  const a = Buffer.from(recibido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * URL del Web Checkout de Wompi.
 * @param {{ llavePublica: string, secretoIntegridad: string, referencia: string, montoCentavos: number,
 *           urlRedireccion?: string, email?: string, nombreCompleto?: string, fechaExpiracion?: string }} datos
 */
export function urlCheckout({
  llavePublica,
  secretoIntegridad,
  referencia,
  montoCentavos,
  urlRedireccion,
  email,
  nombreCompleto,
  fechaExpiracion,
}) {
  const parametros = new URLSearchParams({
    'public-key': llavePublica,
    currency: 'COP',
    'amount-in-cents': String(montoCentavos),
    reference: referencia,
    'signature:integrity': firmaIntegridad({ referencia, montoCentavos, fechaExpiracion }, secretoIntegridad),
  });
  if (urlRedireccion) parametros.set('redirect-url', urlRedireccion);
  if (fechaExpiracion) parametros.set('expiration-time', fechaExpiracion);
  if (email) parametros.set('customer-data:email', email);
  if (nombreCompleto) parametros.set('customer-data:full-name', nombreCompleto);
  return `${URL_CHECKOUT}?${parametros}`;
}
