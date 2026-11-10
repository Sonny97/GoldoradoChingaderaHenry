/**
 * Traduccion de errores gRPC a respuestas HTTP.
 *
 * Los microservicios devuelven sus errores como ESTADO gRPC con un mensaje en
 * español listo para el usuario ("Saldo insuficiente", "Partido no encontrado")
 * y, si hace falta, datos extra en el metadato de cierre `x-datos`. El BFF no
 * reinterpreta nada: elige el codigo HTTP de la tabla de docs/API-REST.md, pone
 * el `details` como `message` y los datos como `data`.
 *
 * La excepcion son los errores de TRANSPORTE (servicio apagado, plazo vencido):
 * esos los fabrica grpc-js en ingles ("No connection established...") y no le
 * dicen nada al usuario, asi que se reescriben con el nombre del servicio.
 */

import { CODIGOS, datosDeError } from '@goldorado/comun';

export const HTTP_POR_CODIGO = Object.freeze({
  [CODIGOS.INVALID_ARGUMENT]: 400,
  [CODIGOS.FAILED_PRECONDITION]: 400,
  [CODIGOS.OUT_OF_RANGE]: 400,
  [CODIGOS.UNAUTHENTICATED]: 401,
  [CODIGOS.PERMISSION_DENIED]: 403,
  [CODIGOS.NOT_FOUND]: 404,
  [CODIGOS.ALREADY_EXISTS]: 409,
  [CODIGOS.ABORTED]: 409,
  [CODIGOS.RESOURCE_EXHAUSTED]: 429,
  [CODIGOS.UNAVAILABLE]: 503,
  [CODIGOS.DEADLINE_EXCEEDED]: 504,
});

export const MENSAJE_500 = 'Ocurrió un error inesperado en el servidor';

/** Mensajes que fabrica grpc-js (no un microservicio): no se muestran tal cual. */
const DE_TRANSPORTE =
  /no connection established|connect ECONNREFUSED|ECONNRESET|connection dropped|deadline exceeded|name resolution|failed to connect|received rst_stream|call cancelled|getaddrinfo|socket closed|stream refused/i;

/** ¿Es un error que llego de un microservicio por nuestro cliente gRPC? */
export function esErrorGrpc(error) {
  return typeof error?.code === 'number' && (Boolean(error?.servicioOrigen) || 'details' in (error ?? {}));
}

/** Codigo HTTP para un codigo gRPC (500 para lo que no esta en la tabla). */
export function httpDeGrpc(codigo) {
  return HTTP_POR_CODIGO[codigo] ?? 500;
}

/**
 * { status, message, data } listos para el sobre de error.
 * `data` son los datos de x-datos (o null).
 */
export function respuestaDeErrorGrpc(error) {
  const status = httpDeGrpc(error.code);
  const servicio = error.servicioOrigen ?? 'un servicio interno';
  const detalle = String(error.details ?? '').trim();

  if (error.code === CODIGOS.DEADLINE_EXCEEDED) {
    return { status, message: `El servicio ${servicio} tardó demasiado en responder. Intenta de nuevo.`, data: null };
  }
  if (error.code === CODIGOS.UNAVAILABLE && (!detalle || DE_TRANSPORTE.test(detalle))) {
    return { status, message: `El servicio ${servicio} no está disponible en este momento`, data: null };
  }
  if (status === 500) {
    return { status, message: MENSAJE_500, data: null };
  }
  return { status, message: detalle || MENSAJE_500, data: datosDeError(error) };
}

/** ¿El servicio no contesto (apagado, red, plazo)? Distinto de "contesto que no". */
export function esCaida(error) {
  return error?.code === CODIGOS.UNAVAILABLE || error?.code === CODIGOS.DEADLINE_EXCEEDED;
}
