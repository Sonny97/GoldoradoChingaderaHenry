/**
 * Id de correlacion por peticion HTTP.
 *
 * Una pantalla del frontend puede disparar llamadas a tres microservicios. Si
 * cada uno escribe su log por separado, no hay forma de saber que lineas son de
 * la misma peticion. El BFF genera (o respeta, si ya viene de un proxy) un
 * `x-id-solicitud`, lo devuelve en la respuesta y lo propaga en cada llamada
 * gRPC; los servidores lo reciben en ctx.idSolicitud.
 */

import { randomUUID } from 'node:crypto';

const VALIDO = /^[A-Za-z0-9._-]{8,64}$/;

export function idSolicitud(req, res, next) {
  const entrante = req.get('x-id-solicitud');
  req.idSolicitud = entrante && VALIDO.test(entrante) ? entrante : randomUUID();
  res.setHeader('x-id-solicitud', req.idSolicitud);
  next();
}
