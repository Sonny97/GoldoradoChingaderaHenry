/**
 * Validaciones compartidas por la apuesta y el deposito.
 *
 * Estan en el servicio y no solo en el frontend porque el frontend es
 * territorio del usuario: cualquiera manda la peticion con el monto que quiera.
 * La comprobacion del navegador es comodidad; la que cuenta es esta, y detras
 * la respalda la base con sus CHECK.
 */

import { invalido } from '@goldorado/comun';

/**
 * id_usuario lo pone el BFF a partir del token, nunca el cuerpo HTTP. Un 0 aqui
 * es un error de integracion (en proto3 un int64 no enviado llega como 0) y no
 * debe crear una billetera para el "usuario 0".
 */
export function exigirIdUsuario(idUsuario) {
  const id = Number(idUsuario);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalido('Usuario no válido');
  return id;
}

/** Mismos mensajes y mismo orden que apuestaServicio del monolito. */
export function exigirMontoEntero(valor) {
  const monto = Number(valor);

  if (!Number.isFinite(monto) || monto <= 0) {
    throw invalido('Ingresa un monto válido');
  }

  // COP no usa centavos y la columna es NUMERIC(18,2): un monto con decimales
  // se redondearia en silencio y el cliente veria descontado algo distinto de
  // lo que escribio.
  if (!Number.isInteger(monto)) {
    throw invalido('El monto debe ser un valor entero en pesos');
  }

  return monto;
}

/** Texto opcional del contrato ('' = no enviado) -> null o recortado al tamano de la columna. */
export function textoOpcional(valor, maximo) {
  const texto = String(valor ?? '').trim();
  return texto ? texto.slice(0, maximo) : null;
}
