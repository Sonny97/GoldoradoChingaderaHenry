/**
 * @goldorado/comun - lo que comparten los seis microservicios y el BFF.
 *
 *   import { cargarEnv, crearLogger, crearServidorGrpc, crearClienteGrpc,
 *            noEncontrado, crearRpcSalud, apagadoOrdenado } from '@goldorado/comun';
 */

export { cargarEnv, resumenEnv, raizDelPaquete } from './env.js';
export { crearLogger } from './log.js';
export {
  CODIGOS,
  ErrorNegocio,
  noEncontrado,
  yaExiste,
  invalido,
  precondicion,
  noAutenticado,
  sinPermiso,
  noDisponible,
  demasiados,
  aErrorGrpc,
  datosDeError,
  esErrorDeOtroServicio,
} from './errores.js';
export { traducirErrorBaseDatos, esErrorDeConexion } from './baseDatos.js';
export { RUTA_PROTOS, OPCIONES_PROTO, SERVICIOS, cargarPaquete, constructorServicio } from './grpc/proto.js';
export { crearServidorGrpc } from './grpc/servidor.js';
export { crearClienteGrpc, llamadaOpcional } from './grpc/cliente.js';
export { crearRpcSalud, apagadoOrdenado, conTiempoLimite, versionDelPaquete } from './salud.js';
export { aFechaIso, aFechaHoraIso, aNumero, sinVacios, formatearCOP } from './formato.js';
