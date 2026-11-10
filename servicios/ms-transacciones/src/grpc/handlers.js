// =============================================================================
//  Implementacion del servicio Transacciones (proto/transacciones.proto).
//
//  Los handlers solo TRADUCEN: request -> servicio -> documento -> mensaje.
//  No deciden ni consultan. Los errores de negocio (ErrorNegocio) y los de
//  la base (traducirErrorBaseDatos: 11000 -> ALREADY_EXISTS, 121 ->
//  FAILED_PRECONDITION, Mongo caido -> UNAVAILABLE) los convierte el servidor
//  de @goldorado/comun en el estado gRPC; aqui no se atrapa nada.
// =============================================================================

import { eventoAMensaje, transaccionAMensaje } from '../utils/mapeo.js';

/**
 * @param {object} o
 * @param {ReturnType<import('../servicios/transacciones.js').crearServicioTransacciones>} o.transacciones
 * @param {ReturnType<import('../servicios/seguridad.js').crearServicioSeguridad>} o.seguridad
 * @param {Function} o.salud  handler de crearRpcSalud
 */
export function crearHandlers({ transacciones, seguridad, salud }) {
  return {
    Salud: salud,

    async RegistrarTransaccion(req) {
      return transaccionAMensaje(await transacciones.registrar(req));
    },

    async ActualizarEstadoTransaccion(req) {
      return transaccionAMensaje(await transacciones.actualizarEstado(req));
    },

    async ListarTransacciones(req) {
      const documentos = await transacciones.listar(req);
      return { transacciones: documentos.map(transaccionAMensaje) };
    },

    async ObtenerTransaccion(req) {
      return transaccionAMensaje(await transacciones.obtener(req));
    },

    async RegistrarIntentoSesion(req) {
      await seguridad.registrarIntento(req);
      return {};
    },

    async ContarIntentosFallidos(req) {
      return { fallidos: await seguridad.contarFallidos(req) };
    },

    async RegistrarEventoSeguridad(req) {
      await seguridad.registrarEvento(req);
      return {};
    },

    async ListarEventosSeguridad(req) {
      const documentos = await seguridad.listarEventos(req);
      return { eventos: documentos.map(eventoAMensaje) };
    },
  };
}
