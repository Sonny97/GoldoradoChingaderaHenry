/**
 * Filtro de estado, orden de relevancia y el SQL que arma el repositorio, sin
 * MySQL: se prueba la consulta que SALE, no lo que la base hace con ella.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ORDEN_DESTACADOS,
  ORDEN_RELEVANCIA,
  SELECT_ENCUENTRO,
  consultaListado,
} from '../src/repositorios/encuentroRepo.js';
import {
  ESTADOS_ENCUENTRO,
  LIMITE_DESTACADOS,
  LIMITE_MAXIMO,
  MAX_IDS,
  filtroDeEstado,
  idsValidos,
  limiteDestacados,
  limiteListado,
} from '../src/servicios/reglas.js';

const compacto = (sql) => sql.replace(/\s+/g, ' ').trim();

describe('filtroDeEstado', () => {
  it("'' , 'all' o ausente = todos", () => {
    for (const estado of ['', 'all', undefined, null, '  ']) {
      assert.deepEqual(filtroDeEstado(estado), { vacio: false, estado: null });
    }
  });

  it('un estado valido filtra por ese estado', () => {
    for (const estado of ESTADOS_ENCUENTRO) {
      assert.deepEqual(filtroDeEstado(estado), { vacio: false, estado });
    }
  });

  it("un estado que no existe ('esports') = lista vacia, no todos", () => {
    assert.deepEqual(filtroDeEstado('esports'), { vacio: true, estado: null });
    assert.equal(filtroDeEstado('LIVE').vacio, true);
  });
});

describe('orden de relevancia', () => {
  it('live, upcoming, finished, canceled: el CASE del SQL sigue ESTADOS_ENCUENTRO', () => {
    assert.deepEqual([...ESTADOS_ENCUENTRO], ['live', 'upcoming', 'finished', 'canceled']);
    ESTADOS_ENCUENTRO.forEach((estado, posicion) => {
      assert.match(ORDEN_RELEVANCIA, new RegExp(`WHEN '${estado}'\\s+THEN ${posicion}\\b`));
    });
    // y despues del grupo, por kickoff
    assert.match(compacto(ORDEN_RELEVANCIA), /END, e\.fecha_hora/);
  });

  it('destacados: primero destacado DESC y luego la misma relevancia', () => {
    assert.match(compacto(ORDEN_DESTACADOS), /^ORDER BY e\.destacado DESC, CASE e\.estado WHEN 'live' THEN 0/);
  });
});

describe('SELECT_ENCUENTRO (la consulta clave del modelo)', () => {
  it('une encuentro_equipo y equipo DOS veces, con el rol filtrado en el ON', () => {
    const sql = compacto(SELECT_ENCUENTRO);
    assert.match(sql, /JOIN encuentro_equipo loc_ee ON loc_ee\.id_encuentro = e\.id_encuentro AND loc_ee\.rol = 'LOCAL'/);
    assert.match(sql, /JOIN equipo loc_eq ON loc_eq\.id_equipo = loc_ee\.id_equipo/);
    assert.match(sql, /JOIN encuentro_equipo vis_ee ON vis_ee\.id_encuentro = e\.id_encuentro AND vis_ee\.rol = 'VISITANTE'/);
    assert.match(sql, /JOIN equipo vis_eq ON vis_eq\.id_equipo = vis_ee\.id_equipo/);
    assert.match(sql, /COALESCE\(p\.nombre, t\.confederacion\) AS torneo_pais/);
  });
});

describe('consultaListado', () => {
  it('sin filtros: sin WHERE, sin LIMIT y sin parametros', () => {
    const { sql, parametros } = consultaListado();
    assert.doesNotMatch(sql, /WHERE/);
    assert.doesNotMatch(sql, /LIMIT/);
    assert.deepEqual(parametros, []);
  });

  it('todos los filtros van como ? y el LIMIT como NUMERO, en orden', () => {
    const { sql, parametros } = consultaListado({ estado: 'live', idTorneo: '1', idEquipo: 5, limite: '10' });
    const plano = compacto(sql);
    assert.match(plano, /WHERE e\.estado = \? AND t\.id_torneo = \? AND e\.id_encuentro IN \(SELECT ee\.id_encuentro FROM encuentro_equipo ee WHERE ee\.id_equipo = \?\)/);
    assert.match(plano, /LIMIT \?$/);
    assert.deepEqual(parametros, ['live', 1, 5, 10]);
    assert.equal(typeof parametros.at(-1), 'number');
    // ningun valor se concatena en el texto
    assert.doesNotMatch(sql, /e\.estado = 'live'/);
    assert.doesNotMatch(sql, /id_equipo = 5/);
  });

  it('destacadosPrimero cambia solo el ORDER BY', () => {
    const { sql } = consultaListado({ limite: 4, destacadosPrimero: true });
    assert.match(compacto(sql), /ORDER BY e\.destacado DESC/);
  });
});

describe('limites e ids', () => {
  it('limite del listado: ausente o <= 0 = sin limite; con tope', () => {
    assert.equal(limiteListado(undefined), null);
    assert.equal(limiteListado(0), null);
    assert.equal(limiteListado(-3), null);
    assert.equal(limiteListado(7), 7);
    assert.equal(limiteListado(10_000), LIMITE_MAXIMO);
  });

  it('destacados: 0 = 4 por defecto', () => {
    assert.equal(limiteDestacados(0), LIMITE_DESTACADOS);
    assert.equal(LIMITE_DESTACADOS, 4);
    assert.equal(limiteDestacados(2), 2);
  });

  it('ids: enteros positivos sin repetir; demasiados -> INVALID_ARGUMENT', () => {
    assert.deepEqual(idsValidos([3, 3, 0, -1, 1.5, 9]), [3, 9]);
    assert.deepEqual(idsValidos([]), []);
    assert.deepEqual(idsValidos(undefined), []);
    const muchos = Array.from({ length: MAX_IDS + 1 }, (_, i) => i + 1);
    assert.throws(() => idsValidos(muchos), { name: 'ErrorNegocio' });
  });
});
