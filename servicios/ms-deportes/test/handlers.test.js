/**
 * Handlers gRPC + servicio con repositorios FALSOS (sin MySQL ni red).
 *
 * Tambien se pasa cada respuesta por el serializador REAL del .proto: si un
 * campo tuviera mal el nombre, protobuf lo descartaria en silencio y la prueba
 * de ida y vuelta lo detecta.
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

/** Respuesta -> bytes -> objeto, con el contrato de verdad. */
function idaYVuelta(metodo, respuesta) {
  const def = DEFINICION[metodo];
  return def.responseDeserialize(def.responseSerialize(respuesta));
}

describe('contrato', () => {
  it('existe un handler por cada rpc del .proto (si falta uno el servidor no arranca)', () => {
    const { handlers } = montar();
    assert.deepEqual(Object.keys(handlers).sort(), Object.keys(DEFINICION).sort());
  });
});

describe('ListarEncuentros', () => {
  it("estado invalido ('esports') -> lista vacia y NO consulta", async () => {
    const { repos, handlers } = montar();
    const respuesta = await handlers.ListarEncuentros({ estado: 'esports' });
    assert.deepEqual(respuesta, { encuentros: [] });
    assert.equal(repos.de('listar').length, 0);
  });

  it("'all' = todos; los filtros en 0 o ausentes no filtran", async () => {
    const { repos, handlers } = montar();
    const respuesta = await handlers.ListarEncuentros({ estado: 'all', idTorneo: 0 });
    assert.equal(respuesta.encuentros.length, 2);
    assert.deepEqual(repos.de('listar')[0].args[0], { estado: null, idTorneo: null, idEquipo: null, limite: null });
  });

  it('colores de TODOS los equipos en UNA sola consulta (sin N+1)', async () => {
    const { repos, handlers } = montar();
    await handlers.ListarEncuentros({ estado: '' });
    const colores = repos.de('coloresDeEquipos');
    assert.equal(colores.length, 1);
    assert.deepEqual(colores[0].args[0], [1, 2, 3, 4]);
  });

  it('pasa estado, torneo, equipo y limite al repositorio', async () => {
    const { repos, handlers } = montar();
    await handlers.ListarEncuentros({ estado: 'live', idTorneo: 1, idEquipo: 2, limite: 5 });
    assert.deepEqual(repos.de('listar')[0].args[0], { estado: 'live', idTorneo: 1, idEquipo: 2, limite: 5 });
  });

  it('el proximo viaja SIN goles ni minuto por el cable', async () => {
    const { handlers } = montar();
    const respuesta = idaYVuelta('ListarEncuentros', await handlers.ListarEncuentros({ estado: 'upcoming' }));
    const [proximo] = respuesta.encuentros;
    assert.equal(proximo.id, 5);
    assert.equal(proximo.golesLocal, undefined);
    assert.equal(proximo.golesVisitante, undefined);
    assert.equal(proximo.minuto, undefined);
    assert.equal(proximo.local.codigoCorto, 'AME');
    assert.equal(proximo.local.torneo, null); // sin torneo embebido en el equipo
    assert.equal(proximo.torneo.temporada, '2026-II');
  });
});

describe('ListarDestacados', () => {
  it('limite 0 -> 4 por defecto', async () => {
    const { repos, handlers } = montar();
    await handlers.ListarDestacados({ limite: 0 });
    assert.equal(repos.de('listarDestacados')[0].args[0], 4);
  });
});

describe('ObtenerEncuentro / ObtenerEquipo', () => {
  it("id inexistente -> NOT_FOUND 'Partido no encontrado'", async () => {
    const { handlers } = montar();
    await assert.rejects(handlers.ObtenerEncuentro({ id: 99 }), {
      codigo: CODIGOS.NOT_FOUND,
      message: 'Partido no encontrado',
    });
  });

  it("id 0 -> INVALID_ARGUMENT 'Identificador de partido inválido' (como el monolito)", async () => {
    const { repos, handlers } = montar();
    await assert.rejects(handlers.ObtenerEncuentro({ id: 0 }), {
      codigo: CODIGOS.INVALID_ARGUMENT,
      message: 'Identificador de partido inválido',
    });
    assert.equal(repos.de('buscarPorId').length, 0);
  });

  it('encuentro existente: marcador 1-0 (el 0 si viaja)', async () => {
    const { handlers } = montar();
    const e = idaYVuelta('ObtenerEncuentro', await handlers.ObtenerEncuentro({ id: 1 }));
    assert.equal(e.golesLocal, 1);
    assert.equal(e.golesVisitante, 0);
    assert.equal(e.minuto, 67);
    assert.equal(e.fechaHora, '2026-11-09T19:00:00.000Z');
    assert.deepEqual(e.visitante.colores, { primario: '#101b36', secundario: '#f4f6fb' });
  });

  it("equipo inexistente -> NOT_FOUND 'Equipo no encontrado'", async () => {
    const { handlers } = montar();
    await assert.rejects(handlers.ObtenerEquipo({ id: 99 }), {
      codigo: CODIGOS.NOT_FOUND,
      message: 'Equipo no encontrado',
    });
  });

  it('equipo existente con su torneo y sus colores', async () => {
    const { handlers } = montar();
    const eq = idaYVuelta('ObtenerEquipo', await handlers.ObtenerEquipo({ id: 1 }));
    assert.equal(eq.codigoCorto, 'MIL');
    assert.equal(eq.fundacion, '1946-06-18');
    assert.equal(eq.torneo.nombre, 'Liga BetPlay');
    assert.deepEqual(eq.colores, { primario: '#123a8f', secundario: '#ffffff' });
  });
});

describe('ObtenerDetalleEncuentro', () => {
  it('encuentro + estadistica en pares + alineacion con estadistica individual', async () => {
    const { handlers } = montar();
    const d = idaYVuelta('ObtenerDetalleEncuentro', await handlers.ObtenerDetalleEncuentro({ id: 1 }));
    assert.equal(d.encuentro.id, 1);
    // (deserializado, cada optional presente trae ademas la propiedad virtual _local)
    assert.equal(d.estadisticas.posesion.local, 58);
    assert.equal(d.estadisticas.posesion.visitante, 42);
    assert.equal(d.estadisticas.tirosArco.local, 5);
    assert.equal(d.estadisticas.corners.visitante, undefined);
    assert.equal(d.alineacion.length, 2);
    assert.equal(d.alineacion[0].nombre, 'Santiago Bermúdez');
    assert.equal(d.alineacion[0].goles, 1);
    assert.equal(d.alineacion[1].dorsal, undefined);
  });

  it('partido sin estadistica -> el mensaje estadisticas va ausente', async () => {
    const { handlers } = montar();
    const d = idaYVuelta('ObtenerDetalleEncuentro', await handlers.ObtenerDetalleEncuentro({ id: 5 }));
    assert.equal(d.estadisticas, null);
    assert.deepEqual(d.alineacion, []);
  });

  it("inexistente -> NOT_FOUND y no consulta estadistica", async () => {
    const { repos, handlers } = montar();
    await assert.rejects(handlers.ObtenerDetalleEncuentro({ id: 42 }), { codigo: CODIGOS.NOT_FOUND });
    assert.equal(repos.de('estadistica').length, 0);
  });
});

describe('ObtenerEncuentrosPorIds', () => {
  it('lista vacia -> vacia, sin consultar', async () => {
    const { repos, handlers } = montar();
    assert.deepEqual(await handlers.ObtenerEncuentrosPorIds({ ids: [] }), { encuentros: [] });
    assert.equal(repos.de('buscarPorIds').length, 0);
  });

  it('los ids que no existen simplemente no vienen; los repetidos se piden una vez', async () => {
    const { repos, handlers } = montar();
    const { encuentros } = await handlers.ObtenerEncuentrosPorIds({ ids: [5, 99, 5] });
    assert.deepEqual(repos.de('buscarPorIds')[0].args[0], [5, 99]);
    assert.deepEqual(encuentros.map((e) => e.id), [5]);
  });
});

describe('ListarCalendario y catalogos', () => {
  it('jornadas con SUS encuentros, en 3 consultas (jornadas, encuentros, colores)', async () => {
    const { repos, handlers } = montar();
    const { jornadas } = idaYVuelta('ListarCalendario', await handlers.ListarCalendario({ idTorneo: 1 }));
    assert.deepEqual(repos.de('jornadas')[0].args[0], { idTorneo: 1, numeroJornada: null });
    assert.deepEqual(repos.de('deJornadas')[0].args[0], [2, 1]);
    assert.equal(repos.de('coloresDeEquipos').length, 1);
    assert.deepEqual(jornadas[0].encuentros.map((e) => e.id), [1, 5]);
    assert.equal(jornadas[0].fechaInicio, '2026-11-08');
    assert.deepEqual(jornadas[1].encuentros, []);
  });

  it('ListarTorneos y ListarEquipos envuelven la lista en su mensaje', async () => {
    const { handlers } = montar();
    const { torneos } = idaYVuelta('ListarTorneos', await handlers.ListarTorneos({}));
    assert.equal(torneos[0].pais, 'CONMEBOL');
    const { equipos } = idaYVuelta('ListarEquipos', await handlers.ListarEquipos({}));
    assert.equal(equipos[0].torneo.acento, '#e7c566');
  });
});
