/**
 * Fila de MySQL -> mensaje del contrato. Aqui se vigila la diferencia entre
 * "no hay dato" (campo ausente) y "el dato es cero".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COLORES_POR_DEFECTO,
  aEncuentro,
  aEquipo,
  aEstadio,
  aEstadisticas,
  aJornadaCalendario,
  aJugador,
  aJugadorAlineado,
  aTorneo,
  idsDeEquipos,
  mapaDeColores,
} from '../src/servicios/mapeadores.js';
import { FILAS_ALINEACION, FILAS_COLOR, FILA_ESTADISTICA, filaEncuentro, filaProximo } from './falsos.js';

const colores = mapaDeColores(FILAS_COLOR);

describe('aEncuentro', () => {
  it('un partido sin marcador NO va 0-0: goles y minuto quedan ausentes', () => {
    const e = aEncuentro(filaProximo(), colores);
    assert.equal(e.golesLocal, undefined);
    assert.equal(e.golesVisitante, undefined);
    assert.equal(e.minuto, undefined);
    assert.equal(e.estado, 'upcoming');
    assert.equal(e.destacado, false);
  });

  it('un cero real si viaja como 0', () => {
    const e = aEncuentro(filaEncuentro(), colores);
    assert.equal(e.golesLocal, 1);
    assert.equal(e.golesVisitante, 0);
  });

  it('en vivo lleva minuto; terminado no, aunque la fila lo traiga', () => {
    assert.equal(aEncuentro(filaEncuentro(), colores).minuto, 67);
    assert.equal(aEncuentro(filaEncuentro({ estado: 'finished', minuto: 90 }), colores).minuto, undefined);
  });

  it('kickoff en ISO 8601 UTC, torneo embebido y numero de jornada', () => {
    const e = aEncuentro(filaEncuentro(), colores);
    assert.equal(e.fechaHora, '2026-11-09T19:00:00.000Z');
    assert.equal(e.destacado, true);
    assert.equal(e.numeroJornada, 2);
    assert.deepEqual(e.torneo, {
      id: 1,
      nombre: 'Liga BetPlay',
      pais: 'Colombia',
      temporada: '2026-II',
      acento: '#e7c566',
    });
  });

  it('arma local y visitante desde las columnas loc_/vis_, sin torneo embebido', () => {
    const e = aEncuentro(filaEncuentro(), colores);
    assert.equal(e.local.id, 1);
    assert.equal(e.local.codigoCorto, 'MIL');
    assert.equal(e.local.ciudad, 'Bogotá');
    assert.equal(e.local.fundacion, '1946-06-18');
    assert.equal(e.visitante.id, 2);
    assert.equal(e.visitante.nombre, 'Atlético Nacional');
    assert.equal(e.visitante.crestSeed, 1);
    assert.equal(e.local.torneo, undefined);
  });

  it('estadio y arbitro NULL quedan ausentes', () => {
    const e = aEncuentro(filaEncuentro({ estadio: null, arbitro: null }), colores);
    assert.equal(e.estadio, undefined);
    assert.equal(e.arbitro, undefined);
  });
});

describe('colores', () => {
  it('equipo sin colores -> los de defecto del monolito', () => {
    const e = aEncuentro(filaEncuentro(), colores);
    assert.deepEqual(e.local.colores, { primario: '#123a8f', secundario: '#ffffff' });
    assert.deepEqual(e.visitante.colores, COLORES_POR_DEFECTO);
    assert.deepEqual(COLORES_POR_DEFECTO, { primario: '#101b36', secundario: '#f4f6fb' });
  });

  it('si falta solo uno de los dos, se completa campo por campo', () => {
    const e = aEncuentro(filaProximo(), colores);
    assert.deepEqual(e.local.colores, { primario: '#c8102e', secundario: '#f4f6fb' });
  });

  it('idsDeEquipos junta local y visitante sin repetir (una sola consulta IN)', () => {
    assert.deepEqual(idsDeEquipos([filaEncuentro(), filaEncuentro({ id_encuentro: 9, local_id: 2, visita_id: 3 })]), [1, 2, 3]);
  });
});

describe('aEstadisticas', () => {
  it('sin fila -> mensaje ausente (no una estadistica de ceros)', () => {
    assert.equal(aEstadisticas(null), undefined);
  });

  it('pares local/visitante; DECIMAL en cadena -> numero; NULL -> ausente', () => {
    const s = aEstadisticas(FILA_ESTADISTICA);
    assert.deepEqual(s.posesion, { local: 58, visitante: 42 });
    assert.deepEqual(s.tirosArco, { local: 5, visitante: 2 });
    assert.equal(s.corners.local, 6);
    assert.equal(s.corners.visitante, undefined);
  });
});

describe('alineacion y catalogos', () => {
  it('jugador alineado: nombre completo, titular booleano, minutos NULL ausentes', () => {
    const [titular, suplente] = FILAS_ALINEACION.map(aJugadorAlineado);
    assert.equal(titular.nombre, 'Santiago Bermúdez');
    assert.equal(titular.titular, true);
    assert.equal(titular.goles, 1);
    assert.equal(titular.minutos, 67);
    assert.equal(suplente.titular, false);
    assert.equal(suplente.dorsal, undefined);
    assert.equal(suplente.minutos, undefined);
  });

  it('torneo: pais = COALESCE(pais, confederacion) ya resuelto por la base', () => {
    assert.deepEqual(
      aTorneo({ id_torneo: 2, nombre: 'Copa Libertadores', accent_hex: '#3b82f6', pais: 'CONMEBOL', temporada: null }),
      { id: 2, nombre: 'Copa Libertadores', pais: 'CONMEBOL', temporada: '', acento: '#3b82f6' }
    );
  });

  it('equipo con su torneo y fundacion YYYY-MM-DD sin correrse de dia', () => {
    const eq = aEquipo(
      {
        id_equipo: 1,
        id_torneo: 1,
        equipo_nombre: 'Millonarios',
        equipo_codigo: 'MIL',
        crest_seed: 0,
        fundacion: '1946-06-18',
        equipo_ciudad: 'Bogotá',
        torneo_nombre: 'Liga BetPlay',
        torneo_accent: '#e7c566',
        torneo_pais: 'Colombia',
        torneo_temporada: '2026-II',
      },
      colores
    );
    assert.equal(eq.fundacion, '1946-06-18');
    assert.equal(eq.torneo.nombre, 'Liga BetPlay');
    assert.deepEqual(eq.colores, { primario: '#123a8f', secundario: '#ffffff' });
  });

  it('jugador: dorsal y pais de nacimiento opcionales; activo booleano', () => {
    const j = aJugador({
      id_jugador: 7,
      id_equipo: 3,
      nombres: 'Brayan',
      apellidos: 'Solís',
      posicion: 'PORTERO',
      dorsal: null,
      fecha_nacimiento: '1996-02-19',
      activo: 1,
      pais_nacimiento: null,
      equipo_nombre: 'América de Cali',
    });
    assert.equal(j.dorsal, undefined);
    assert.equal(j.paisNacimiento, undefined);
    assert.equal(j.fechaNacimiento, '1996-02-19');
    assert.equal(j.activo, true);
    assert.equal(j.equipo, 'América de Cali');
  });

  it('estadio sin capacidad -> capacidad ausente', () => {
    const e = aEstadio({ id_estadio: 1, nombre: 'El Campín', capacidad: null, ciudad: 'Bogotá', pais: 'Colombia' });
    assert.equal(e.capacidad, undefined);
    assert.equal(e.ciudad, 'Bogotá');
  });

  it('jornada del calendario con fechas YYYY-MM-DD y su temporada', () => {
    const j = aJornadaCalendario({
      id_jornada: 2,
      numero_jornada: 2,
      fecha_inicio: '2026-11-08',
      fecha_fin: '2026-11-14',
      temporada: '2026-II',
      id_torneo: 1,
      torneo_nombre: 'Liga BetPlay',
      torneo_accent: '#e7c566',
      torneo_pais: 'Colombia',
    });
    assert.equal(j.fechaInicio, '2026-11-08');
    assert.equal(j.temporada, '2026-II');
    assert.equal(j.torneo.temporada, '2026-II');
    assert.deepEqual(j.encuentros, []);
  });
});
