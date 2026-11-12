/**
 * ActualizarEncuentro (ADMIN) con repositorios FALSOS: reglas de cada estado,
 * partidos que ya no cambian y la respuesta igual a ObtenerEncuentro.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CODIGOS, constructorServicio } from '@goldorado/comun';

import { crearHandlers } from '../src/grpc/handlers.js';
import { crearServicioDeportes } from '../src/servicios/deportesServicio.js';
import { crearReposFalsos } from './falsos.js';

const DEFINICION = constructorServicio('deportes').service;

function montar() {
  const repos = crearReposFalsos();
  const servicio = crearServicioDeportes(repos);
  const salud = async () => ({ servicio: 'ms-deportes', estado: 'ok' });
  return { repos, handlers: crearHandlers({ servicio, salud }) };
}

function idaYVuelta(metodo, respuesta) {
  const def = DEFINICION[metodo];
  return def.responseDeserialize(def.responseSerialize(respuesta));
}

/** El request tal como lo deserializa gRPC (los optional ausentes quedan undefined). */
function pedido(campos) {
  const def = DEFINICION.ActualizarEncuentro;
  return def.requestDeserialize(def.requestSerialize(campos));
}

describe('ActualizarEncuentro: validaciones', () => {
  it('estado desconocido -> INVALID_ARGUMENT y no toca la base', async () => {
    const { repos, handlers } = montar();
    await assert.rejects(handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'esports' })), {
      codigo: CODIGOS.INVALID_ARGUMENT,
    });
    assert.equal(repos.de('actualizarEstado').length, 0);
  });

  it('live sin minuto o fuera de 0..130 -> INVALID_ARGUMENT', async () => {
    const { handlers } = montar();
    for (const minuto of [undefined, -1, 131]) {
      await assert.rejects(handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'live', minuto })), {
        codigo: CODIGOS.INVALID_ARGUMENT,
      });
    }
  });

  it('finished sin los dos marcadores o con goles negativos -> INVALID_ARGUMENT', async () => {
    const { handlers } = montar();
    await assert.rejects(handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'finished', golesLocal: 2 })), {
      codigo: CODIGOS.INVALID_ARGUMENT,
    });
    await assert.rejects(
      handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'finished', golesLocal: 2, golesVisitante: -1 })),
      { codigo: CODIGOS.INVALID_ARGUMENT }
    );
  });

  it("id inexistente -> NOT_FOUND 'Partido no encontrado'", async () => {
    const { handlers } = montar();
    await assert.rejects(handlers.ActualizarEncuentro(pedido({ id: 99, estado: 'upcoming' })), {
      codigo: CODIGOS.NOT_FOUND,
      message: 'Partido no encontrado',
    });
  });
});

describe('ActualizarEncuentro: transiciones', () => {
  it('live -> finished 2-2: minuto NULL y devuelve el Encuentro completo', async () => {
    const { handlers } = montar();
    const e = idaYVuelta(
      'ActualizarEncuentro',
      await handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'finished', golesLocal: 2, golesVisitante: 2 }))
    );
    assert.equal(e.estado, 'finished');
    assert.equal(e.golesLocal, 2);
    assert.equal(e.golesVisitante, 2);
    assert.equal(e.minuto, undefined);
    const igual = idaYVuelta('ObtenerEncuentro', await handlers.ObtenerEncuentro({ id: 1 }));
    assert.deepEqual(e, igual);
  });

  it('finished 0-0 tambien es un marcador valido', async () => {
    const { handlers } = montar();
    const e = await handlers.ActualizarEncuentro(pedido({ id: 5, estado: 'finished', golesLocal: 0, golesVisitante: 0 }));
    assert.equal(e.golesLocal, 0);
    assert.equal(e.golesVisitante, 0);
  });

  it('upcoming -> live sin goles arranca 0-0 con su minuto', async () => {
    const { handlers } = montar();
    const e = await handlers.ActualizarEncuentro(pedido({ id: 5, estado: 'live', minuto: 0 }));
    assert.equal(e.estado, 'live');
    assert.equal(e.minuto, 0);
    assert.equal(e.golesLocal, 0);
    assert.equal(e.golesVisitante, 0);
  });

  it('live sin goles conserva el marcador actual (1-0) y cambia el minuto', async () => {
    const { handlers } = montar();
    const e = await handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'live', minuto: 80 }));
    assert.equal(e.minuto, 80);
    assert.equal(e.golesLocal, 1);
    assert.equal(e.golesVisitante, 0);
  });

  it('upcoming borra marcador y minuto', async () => {
    const { handlers } = montar();
    const e = idaYVuelta(
      'ActualizarEncuentro',
      await handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'upcoming', golesLocal: 3, golesVisitante: 1 }))
    );
    assert.equal(e.estado, 'upcoming');
    assert.equal(e.minuto, undefined);
    assert.equal(e.golesLocal, undefined);
    assert.equal(e.golesVisitante, undefined);
  });

  it('canceled conserva el marcador y quita el minuto', async () => {
    const { handlers } = montar();
    const e = await handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'canceled', golesLocal: 5, golesVisitante: 5 }));
    assert.equal(e.estado, 'canceled');
    assert.equal(e.golesLocal, 1);
    assert.equal(e.golesVisitante, 0);
    assert.equal(e.minuto, undefined);
  });

  it('un partido terminado o cancelado ya no cambia (FAILED_PRECONDITION)', async () => {
    const { handlers } = montar();
    await handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'finished', golesLocal: 1, golesVisitante: 0 }));
    await assert.rejects(handlers.ActualizarEncuentro(pedido({ id: 1, estado: 'live', minuto: 90 })), {
      codigo: CODIGOS.FAILED_PRECONDITION,
      message: 'El partido ya terminó y no se puede modificar',
    });

    await handlers.ActualizarEncuentro(pedido({ id: 5, estado: 'canceled' }));
    await assert.rejects(handlers.ActualizarEncuentro(pedido({ id: 5, estado: 'upcoming' })), {
      codigo: CODIGOS.FAILED_PRECONDITION,
      message: 'El partido fue cancelado y no se puede modificar',
    });
  });
});
