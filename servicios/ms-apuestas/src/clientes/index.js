/**
 * Clientes gRPC hacia los otros microservicios que necesita ms-apuestas.
 *
 * - ms-deportes: el estado del partido antes de aceptar una apuesta. Plazo
 *   corto: el usuario esta esperando la respuesta del boton "Apostar".
 * - ms-transacciones: el libro contable en MongoDB, solo desde el relevo de la
 *   bandeja de salida (nunca en el camino de la apuesta).
 *
 * Los servicios reciben estas fachadas pequenas y no el cliente gRPC: asi las
 * pruebas inyectan un objeto falso con el mismo metodo.
 */

import { crearClienteGrpc } from '@goldorado/comun';

/** @param {{ MS_DEPORTES_URL: string, MS_TRANSACCIONES_URL: string, GRPC_TOKEN_INTERNO: string }} env */
export function crearClientes(env) {
  const tokenInterno = env.GRPC_TOKEN_INTERNO;
  const deportes = crearClienteGrpc('deportes', { direccion: env.MS_DEPORTES_URL, tokenInterno, plazoMs: 3000 });
  const transacciones = crearClienteGrpc('transacciones', {
    direccion: env.MS_TRANSACCIONES_URL,
    tokenInterno,
    plazoMs: 5000,
  });

  return {
    deportes: {
      obtenerEncuentro: (id) => deportes.ObtenerEncuentro({ id }),
    },
    transacciones: {
      registrarTransaccion: (carga) => transacciones.RegistrarTransaccion(carga),
    },
    cerrar() {
      deportes.cerrar?.();
      transacciones.cerrar?.();
    },
  };
}
