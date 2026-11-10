/**
 * Las fachadas de src/clientes contra servidores gRPC FALSOS en 127.0.0.1
 * (implementacionParcial): comprueba que los mensajes que arma ms-apuestas
 * encajan en los .proto reales de ms-deportes y ms-transacciones, sin bases.
 *
 * - ObtenerEncuentro({ id }) y los estados finished / NOT_FOUND / caido.
 * - La carga de la bandeja de salida, tal como sale de JSONB, llega completa a
 *   RegistrarTransaccion (camelCase -> snake_case del proto y de vuelta).
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS, crearServidorGrpc, noEncontrado } from '@goldorado/comun';
import { implementacionParcial, puertoLibre } from '@goldorado/comun/pruebas';
import { crearClientes } from '../src/clientes/index.js';
import { crearServicioApuestas } from '../src/servicios/apuestaServicio.js';
import { logEnMemoria, rechazaCon } from './falsos.js';

describe('clientes gRPC contra servidores falsos', () => {
  const recibidas = [];
  let deportesFalso;
  let transaccionesFalso;
  let clientes;

  before(async () => {
    deportesFalso = crearServidorGrpc({ nombre: 'ms-deportes-falso', log: logEnMemoria() });
    deportesFalso.registrar(
      'deportes',
      implementacionParcial('deportes', {
        async ObtenerEncuentro({ id }) {
          if (id === 404) throw noEncontrado('Partido no encontrado');
          return { id, estado: id === 9 ? 'finished' : 'live', fechaHora: '2026-11-09T15:00:00.000Z' };
        },
      })
    );
    transaccionesFalso = crearServidorGrpc({ nombre: 'ms-transacciones-falso', log: logEnMemoria() });
    transaccionesFalso.registrar(
      'transacciones',
      implementacionParcial('transacciones', {
        async RegistrarTransaccion(peticion) {
          recibidas.push(peticion);
          return { codigo: peticion.codigo };
        },
      })
    );

    const puertoDeportes = await deportesFalso.iniciar(await puertoLibre(), '127.0.0.1');
    const puertoTransacciones = await transaccionesFalso.iniciar(await puertoLibre(), '127.0.0.1');
    clientes = crearClientes({
      MS_DEPORTES_URL: `127.0.0.1:${puertoDeportes}`,
      MS_TRANSACCIONES_URL: `127.0.0.1:${puertoTransacciones}`,
      GRPC_TOKEN_INTERNO: '',
    });
  });

  after(async () => {
    clientes?.cerrar();
    await deportesFalso?.apagar(500);
    await transaccionesFalso?.apagar(500);
  });

  /** Servicio real con repo falso: la cuota 1 pertenece al encuentro pedido. */
  function servicioCon(deportes, idEncuentro) {
    const repo = {
      async contextoDeCuota() {
        return {
          idCuota: 1, valorCuota: 2, estadoCuota: 'ABIERTO', idEncuentro, seleccion: 'Local',
          mercado: '1X2', idRegla: 1, montoMinimo: 5000, montoMaximo: 5000000,
        };
      },
      async registrarApuesta() {
        throw new Error('no deberia llegar a mover dinero');
      },
    };
    return crearServicioApuestas({ repo, deportes, log: logEnMemoria() });
  }

  test('ObtenerEncuentro responde el estado y el servicio rechaza un partido terminado', async () => {
    const encuentro = await clientes.deportes.obtenerEncuentro(9);
    assert.equal(encuentro.id, 9);
    assert.equal(encuentro.estado, 'finished');

    const servicio = servicioCon(clientes.deportes, 9);
    await rechazaCon(
      servicio.registrarApuesta({ idUsuario: 1, idCuota: 1, monto: 10000 }),
      CODIGOS.FAILED_PRECONDITION,
      'Este partido ya terminó'
    );
  });

  test('NOT_FOUND de ms-deportes viaja como codigo gRPC', async () => {
    const servicio = servicioCon(clientes.deportes, 404);
    await rechazaCon(
      servicio.registrarApuesta({ idUsuario: 1, idCuota: 1, monto: 10000 }),
      CODIGOS.NOT_FOUND,
      'Partido no encontrado'
    );
  });

  test('ms-deportes apagado -> UNAVAILABLE con el mensaje para el usuario', async () => {
    const caidos = crearClientes({ MS_DEPORTES_URL: '127.0.0.1:1', MS_TRANSACCIONES_URL: '127.0.0.1:1', GRPC_TOKEN_INTERNO: '' });
    try {
      const servicio = servicioCon(caidos.deportes, 1);
      await rechazaCon(
        servicio.registrarApuesta({ idUsuario: 1, idCuota: 1, monto: 10000 }),
        CODIGOS.UNAVAILABLE,
        'No pudimos verificar el estado del partido. Intenta de nuevo.'
      );
    } finally {
      caidos.cerrar();
    }
  });

  test('la carga de evento_salida (ida y vuelta por JSONB) llega completa a RegistrarTransaccion', async () => {
    const carga = JSON.parse(
      JSON.stringify({
        codigo: 'b3a1c0de-0009-4a00-9000-000000000009',
        idUsuario: 1,
        tipo: 'APUESTA',
        estado: 'COMPLETADO',
        monto: 50000,
        moneda: 'COP',
        origen: 'ms-apuestas',
        referenciaExterna: 'apuesta:77',
        ejecutadoPor: 'APUESTA_WEB',
        fecha: '2026-11-09T15:00:00.000Z',
      })
    );

    await clientes.transacciones.registrarTransaccion(carga);

    const recibida = recibidas.at(-1);
    assert.equal(recibida.codigo, carga.codigo);
    assert.equal(recibida.idUsuario, 1);
    assert.equal(recibida.tipo, 'APUESTA');
    assert.equal(recibida.estado, 'COMPLETADO');
    assert.equal(recibida.monto, 50000);
    assert.equal(recibida.moneda, 'COP');
    assert.equal(recibida.origen, 'ms-apuestas');
    assert.equal(recibida.referenciaExterna, 'apuesta:77');
    assert.equal(recibida.ejecutadoPor, 'APUESTA_WEB');
    assert.equal(recibida.fecha, '2026-11-09T15:00:00.000Z');
    assert.equal(recibida.proveedor, undefined, 'un optional no enviado queda ausente');
  });
});
