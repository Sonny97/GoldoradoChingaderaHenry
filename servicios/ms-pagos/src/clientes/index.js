/**
 * Clientes gRPC hacia los otros microservicios que necesita ms-pagos.
 *
 * - ms-apuestas: AcreditarDeposito (idempotente por referencia). Es lo unico
 *   que mueve saldo; si falla, el pago queda APROBADO sin acreditar y la
 *   conciliacion reintenta.
 * - ms-transacciones: libro del deposito en MongoDB y eventos de seguridad
 *   (firma de webhook invalida, monto inconsistente, aprobacion duplicada).
 *
 * Los servicios reciben estas fachadas pequenas y no el cliente gRPC: asi las
 * pruebas inyectan un objeto falso con los mismos metodos.
 */

import { crearClienteGrpc } from '@goldorado/comun';

/** @param {{ MS_APUESTAS_URL: string, MS_TRANSACCIONES_URL: string, GRPC_TOKEN_INTERNO: string }} env */
export function crearClientes(env) {
  const tokenInterno = env.GRPC_TOKEN_INTERNO;
  const apuestas = crearClienteGrpc('apuestas', { direccion: env.MS_APUESTAS_URL, tokenInterno, plazoMs: 5000 });
  const transacciones = crearClienteGrpc('transacciones', {
    direccion: env.MS_TRANSACCIONES_URL,
    tokenInterno,
    plazoMs: 5000,
  });

  return {
    apuestas: {
      acreditarDeposito: (carga) => apuestas.AcreditarDeposito(carga),
    },
    transacciones: {
      registrarTransaccion: (carga) => transacciones.RegistrarTransaccion(carga),
      actualizarEstadoTransaccion: (carga) => transacciones.ActualizarEstadoTransaccion(carga),
      registrarEventoSeguridad: (carga) => transacciones.RegistrarEventoSeguridad(carga),
    },
    cerrar() {
      apuestas.cerrar?.();
      transacciones.cerrar?.();
    },
  };
}
