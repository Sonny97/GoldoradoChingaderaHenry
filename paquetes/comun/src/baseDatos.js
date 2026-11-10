/**
 * Traduccion de errores de los CUATRO drivers de base de datos del sistema
 * (mssql, mysql2, pg, mongodb) y de Firestore a un codigo gRPC + mensaje de
 * negocio.
 *
 * Cada motor dice lo mismo con un numero distinto:
 *
 *   | Situacion             | SQL Server | MySQL       | PostgreSQL | MongoDB |
 *   |-----------------------|------------|-------------|------------|---------|
 *   | UNIQUE / PK repetida  | 2627, 2601 | 1062        | 23505      | 11000   |
 *   | FK / CHECK            | 547        | 1451, 1452, | 23503,     | 121     |
 *   |                       |            | 3819        | 23514      | (schema)|
 *   | NULL en NOT NULL      | 515        | 1048        | 23502      |   -     |
 *
 * La regla del proyecto se mantiene: validar en la aplicacion es comodidad;
 * la garantia esta en la base. Cuando la base dice que no, aqui se traduce.
 */

import grpc from '@grpc/grpc-js';

/** Codigos de "la base no responde": son un 503, no un 400. */
const CODIGOS_CONEXION = new Set([
  // mssql / tedious
  'ELOGIN', 'ESOCKET', 'ETIMEOUT', 'ECONNCLOSED', 'ENOTOPEN', 'EINSTLOOKUP',
  // red (todos los drivers)
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN',
  // mysql2
  'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_CON_COUNT_ERROR',
  // PostgreSQL (SQLSTATE): admin_shutdown, cannot_connect_now, too_many_connections,
  // invalid_password, invalid_authorization_specification, invalid_catalog_name
  '57P01', '57P03', '53300', '28P01', '28000', '3D000',
]);

const NOMBRES_CONEXION = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
  'ConnectionError', // mssql
]);

const MSG_DUPLICADO = 'Ya existe un registro con esos datos';
const MSG_INTEGRIDAD = 'La operación viola una regla de integridad de la base de datos';
const MSG_OBLIGATORIO = 'Falta un dato obligatorio';
const MSG_CONEXION = 'No hay conexión con la base de datos. Intenta de nuevo en un momento.';

/**
 * @returns {{codigo:number, mensaje:string, motivo:string} | null}
 *          null si el error no viene de una base de datos.
 */
export function traducirErrorBaseDatos(error) {
  if (!error || typeof error !== 'object') return null;

  const codigo = error.code;
  const numero = error.number ?? error.originalError?.info?.number ?? error.errno;

  if (CODIGOS_CONEXION.has(codigo) || NOMBRES_CONEXION.has(error.name)) {
    return { codigo: grpc.status.UNAVAILABLE, mensaje: MSG_CONEXION, motivo: 'conexion' };
  }

  // ---- SQL Server (error.number) y MySQL (error.errno)
  if (numero === 2627 || numero === 2601 || numero === 1062 || codigo === 'ER_DUP_ENTRY') {
    return { codigo: grpc.status.ALREADY_EXISTS, mensaje: MSG_DUPLICADO, motivo: 'duplicado' };
  }
  if (numero === 547 || numero === 1451 || numero === 1452 || numero === 3819) {
    return { codigo: grpc.status.FAILED_PRECONDITION, mensaje: MSG_INTEGRIDAD, motivo: 'integridad' };
  }
  if (numero === 515 || numero === 1048) {
    return { codigo: grpc.status.INVALID_ARGUMENT, mensaje: MSG_OBLIGATORIO, motivo: 'obligatorio' };
  }

  // ---- PostgreSQL (SQLSTATE de 5 caracteres en error.code)
  if (codigo === '23505') {
    return { codigo: grpc.status.ALREADY_EXISTS, mensaje: MSG_DUPLICADO, motivo: 'duplicado' };
  }
  if (codigo === '23503' || codigo === '23514') {
    return { codigo: grpc.status.FAILED_PRECONDITION, mensaje: MSG_INTEGRIDAD, motivo: 'integridad' };
  }
  if (codigo === '23502') {
    return { codigo: grpc.status.INVALID_ARGUMENT, mensaje: MSG_OBLIGATORIO, motivo: 'obligatorio' };
  }

  // ---- MongoDB (MongoServerError.code numerico)
  if (error.name?.startsWith?.('Mongo')) {
    if (codigo === 11000) {
      return { codigo: grpc.status.ALREADY_EXISTS, mensaje: MSG_DUPLICADO, motivo: 'duplicado' };
    }
    if (codigo === 121) {
      return { codigo: grpc.status.FAILED_PRECONDITION, mensaje: MSG_INTEGRIDAD, motivo: 'esquema' };
    }
  }

  // ---- Firestore: sus errores son estados gRPC (14 UNAVAILABLE, 4 DEADLINE_EXCEEDED)
  if (
    typeof codigo === 'number' &&
    (codigo === grpc.status.UNAVAILABLE || codigo === grpc.status.DEADLINE_EXCEEDED) &&
    !error.servicioOrigen
  ) {
    return { codigo: grpc.status.UNAVAILABLE, mensaje: MSG_CONEXION, motivo: 'conexion' };
  }

  return null;
}

/** ¿El error significa que la base esta caida o inalcanzable? */
export const esErrorDeConexion = (error) => traducirErrorBaseDatos(error)?.motivo === 'conexion';
