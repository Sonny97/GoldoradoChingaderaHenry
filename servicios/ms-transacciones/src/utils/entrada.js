// =============================================================================
//  Normalizacion de lo que llega por gRPC, antes de decidir nada.
//
//  Con defaults:true un string no enviado llega como '' y un `optional` no
//  enviado como undefined; estas funciones convierten ambos casos en "no
//  vino" y dejan los valores listos (recortados, en mayuscula, acotados).
//  Los campos de AUDITORIA se recortan al largo de la columna en vez de
//  rechazarse: perder la traza de un ataque por un user-agent de 2 KB seria
//  peor que guardarlo truncado. Las CLAVES (codigo, referencias) no se
//  recortan: truncarlas podria juntar dos transacciones distintas.
// =============================================================================

import { invalido } from '@goldorado/comun';

/** '' / null / undefined / solo espacios -> undefined; si no, el texto recortado. */
export function textoOpcional(valor, maximo) {
  if (valor === null || valor === undefined) return undefined;
  const limpio = String(valor).trim();
  if (!limpio) return undefined;
  return maximo ? limpio.slice(0, maximo) : limpio;
}

/** Texto obligatorio que NO se trunca: si se pasa del largo, es invalido. */
export function claveObligatoria(valor, maximo, mensaje) {
  const limpio = textoOpcional(valor);
  if (!limpio || limpio.length > maximo) throw invalido(mensaje);
  return limpio;
}

/** Texto opcional que tampoco se trunca (referencias externas). */
export function claveOpcional(valor, maximo, mensaje) {
  const limpio = textoOpcional(valor);
  if (limpio && limpio.length > maximo) throw invalido(mensaje);
  return limpio;
}

/** Valor de una lista cerrada; '' toma el defecto (el DEFAULT de la columna). */
export function enumerado(valor, permitidos, { defecto, mensaje }) {
  const limpio = textoOpcional(valor)?.toUpperCase() ?? defecto;
  if (!limpio || !permitidos.includes(limpio)) throw invalido(mensaje);
  return limpio;
}

/** Fecha ISO opcional; ausente = `ahora`. */
export function fechaOpcional(valor, ahora) {
  const limpio = textoOpcional(valor);
  if (!limpio) return ahora;
  const fecha = new Date(limpio);
  if (Number.isNaN(fecha.getTime())) throw invalido('Fecha inválida');
  return fecha;
}

/** Id de usuario obligatorio (int64 llega como number por longs:Number). */
export function idObligatorio(valor, mensaje) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalido(mensaje);
  return id;
}

/** Id opcional: ausente o 0 = no hay usuario (null). */
export function idOpcional(valor, mensaje = 'Usuario inválido') {
  if (valor === null || valor === undefined || valor === '' || Number(valor) === 0) return null;
  return idObligatorio(valor, mensaje);
}

/** Limite de un listado: 0 o basura = defecto, nunca mas que el maximo. */
export function limite(valor, defecto, maximo) {
  const n = Math.trunc(Number(valor));
  if (!Number.isFinite(n) || n <= 0) return defecto;
  return Math.min(n, maximo);
}
