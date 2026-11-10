/**
 * Prueba de la libreria comun con llamadas gRPC REALES (servidor y cliente en
 * el mismo proceso, puerto aleatorio). Cubre lo que todos los servicios dan por
 * hecho: errores con codigo y datos extra, campos optional, streaming,
 * token interno y traduccion de errores de base de datos.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  crearServidorGrpc,
  crearClienteGrpc,
  crearLogger,
  noEncontrado,
  precondicion,
  datosDeError,
  traducirErrorBaseDatos,
  CODIGOS,
  crearRpcSalud,
  aFechaIso,
  aNumero,
} from '../src/index.js';

const log = crearLogger('prueba');
const TOKEN = 'secreto-de-prueba';

// Implementacion falsa de ms-deportes: solo lo necesario para la prueba; el
// resto de metodos lanza para que registrar() no se queje.
const pendiente = () => {
  throw new Error('no usado');
};

let servidor;
let deportes;
let deportesSinToken;
let imagenes;

before(async () => {
  servidor = crearServidorGrpc({ nombre: 'ms-prueba', log, tokenInterno: TOKEN });

  servidor.registrar('deportes', {
    Salud: crearRpcSalud({
      servicio: 'ms-prueba',
      motor: 'Ninguno',
      baseDatos: 'memoria',
      version: '1.0.0',
      comprobar: async () => {
        throw new Error('base apagada');
      },
    }),
    ListarTorneos: pendiente,
    ListarEquipos: pendiente,
    ObtenerEquipo: pendiente,
    ListarJugadores: pendiente,
    ListarEstadios: pendiente,
    ListarEncuentros: pendiente,
    ListarDestacados: pendiente,
    ObtenerDetalleEncuentro: pendiente,
    ObtenerEncuentrosPorIds: pendiente,
    ListarCalendario: pendiente,
    async ObtenerEncuentro({ id }) {
      if (id === 404) throw noEncontrado('Partido no encontrado');
      if (id === 409) throw precondicion('Demasiados intentos', { tokenDead: true });
      if (id === 422) throw precondicion('Revisa los datos', { campos: { email: 'Ingresa un correo válido, señor' } });
      if (id === 500) throw new Error('fallo tecnico con detalles internos');
      if (id === 503) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return {
        id,
        estado: 'upcoming',
        fechaHora: '2026-11-05T20:00:00.000Z',
        golesLocal: 0,
        local: { id: 1, nombre: 'Millonarios', colores: { primario: '#123a8f', secundario: '#ffffff' } },
      };
    },
  });

  servidor.registrar('imagenes', {
    Salud: pendiente,
    SubirImagen: pendiente,
    ObtenerMetadatos: pendiente,
    BuscarImagenes: pendiente,
    EliminarImagen: pendiente,
    async ObtenerImagen({ id }, ctx) {
      if (id === 'nada') throw noEncontrado('Imagen no encontrada');
      await ctx.escribir({ metadatos: { id, nombre: 'escudo.png', tipoMime: 'image/png', tamanoBytes: 4 } });
      await ctx.escribir({ trozo: Buffer.from([1, 2]) });
      await ctx.escribir({ trozo: Buffer.from([3, 4]) });
    },
  });

  const puerto = await servidor.iniciar(0, '127.0.0.1');
  const direccion = `127.0.0.1:${puerto}`;
  deportes = crearClienteGrpc('deportes', { direccion, tokenInterno: TOKEN, plazoMs: 3000 });
  deportesSinToken = crearClienteGrpc('deportes', { direccion, plazoMs: 3000 });
  imagenes = crearClienteGrpc('imagenes', { direccion, tokenInterno: TOKEN, plazoMs: 3000 });
});

after(async () => {
  deportes?.cerrar();
  deportesSinToken?.cerrar();
  imagenes?.cerrar();
  await servidor?.apagar(1000);
});

test('respuesta normal: camelCase, int64 como number y presencia de optional', async () => {
  const r = await deportes.ObtenerEncuentro({ id: 7 });
  assert.equal(r.id, 7);
  assert.equal(typeof r.id, 'number');
  assert.equal(r.fechaHora, '2026-11-05T20:00:00.000Z');
  assert.equal(r.golesLocal, 0, 'un 0 enviado llega como 0');
  assert.equal(r.golesVisitante, undefined, 'un optional no enviado queda undefined');
  assert.equal(r.visitante, null, 'un mensaje no enviado llega null');
  assert.equal(r.local.colores.primario, '#123a8f');
});

test('error de negocio: codigo y mensaje', async () => {
  await assert.rejects(deportes.ObtenerEncuentro({ id: 404 }), (e) => {
    assert.equal(e.code, CODIGOS.NOT_FOUND);
    assert.equal(e.details, 'Partido no encontrado');
    assert.equal(e.servicioOrigen, 'ms-deportes');
    return true;
  });
});

test('error con datos extra en x-datos', async () => {
  await assert.rejects(deportes.ObtenerEncuentro({ id: 409 }), (e) => {
    assert.equal(e.code, CODIGOS.FAILED_PRECONDITION);
    assert.deepEqual(datosDeError(e), { tokenDead: true });
    return true;
  });
});

test('x-datos con tildes y eñes viaja sin romper los metadatos ASCII', async () => {
  await assert.rejects(deportes.ObtenerEncuentro({ id: 422 }), (e) => {
    assert.equal(e.code, CODIGOS.FAILED_PRECONDITION);
    assert.deepEqual(datosDeError(e), { campos: { email: 'Ingresa un correo válido, señor' } });
    return true;
  });
  // el servidor sigue vivo despues del error
  assert.equal((await deportes.ObtenerEncuentro({ id: 7 })).id, 7);
});

test('excepcion inesperada: INTERNAL sin filtrar el detalle', async () => {
  await assert.rejects(deportes.ObtenerEncuentro({ id: 500 }), (e) => {
    assert.equal(e.code, CODIGOS.INTERNAL);
    assert.ok(!e.details.includes('detalles internos'));
    return true;
  });
});

test('base de datos caida: UNAVAILABLE', async () => {
  await assert.rejects(deportes.ObtenerEncuentro({ id: 503 }), (e) => e.code === CODIGOS.UNAVAILABLE);
});

test('token interno: sin token -> UNAUTHENTICATED', async () => {
  await assert.rejects(deportesSinToken.ObtenerEncuentro({ id: 1 }), (e) => e.code === CODIGOS.UNAUTHENTICATED);
});

test('Salud no lanza aunque la base este caida', async () => {
  const s = await deportes.Salud({});
  assert.equal(s.estado, 'error');
  assert.match(s.detalle, /base apagada/);
  assert.equal(s.servicio, 'ms-prueba');
});

test('streaming de servidor: metadatos y luego trozos', async () => {
  const stream = imagenes.ObtenerImagen({ id: 'abc' });
  const mensajes = [];
  for await (const m of stream) mensajes.push(m);
  assert.equal(mensajes[0].dato, 'metadatos');
  assert.equal(mensajes[0].metadatos.nombre, 'escudo.png');
  const bytes = Buffer.concat(mensajes.slice(1).map((m) => m.trozo));
  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

test('streaming de servidor: error NOT_FOUND', async () => {
  const stream = imagenes.ObtenerImagen({ id: 'nada' });
  await assert.rejects(
    (async () => {
      for await (const _ of stream) {
        // no deberia llegar nada
      }
    })(),
    (e) => e.code === CODIGOS.NOT_FOUND && e.details === 'Imagen no encontrada'
  );
});

test('traduccion de errores de los cuatro motores', () => {
  assert.equal(traducirErrorBaseDatos({ number: 2627 }).codigo, CODIGOS.ALREADY_EXISTS); // SQL Server
  assert.equal(traducirErrorBaseDatos({ errno: 1062, code: 'ER_DUP_ENTRY' }).codigo, CODIGOS.ALREADY_EXISTS); // MySQL
  assert.equal(traducirErrorBaseDatos({ code: '23505' }).codigo, CODIGOS.ALREADY_EXISTS); // PostgreSQL
  assert.equal(traducirErrorBaseDatos({ name: 'MongoServerError', code: 11000 }).codigo, CODIGOS.ALREADY_EXISTS);
  assert.equal(traducirErrorBaseDatos({ number: 547 }).codigo, CODIGOS.FAILED_PRECONDITION);
  assert.equal(traducirErrorBaseDatos({ code: '23514' }).codigo, CODIGOS.FAILED_PRECONDITION);
  assert.equal(traducirErrorBaseDatos({ code: 'ELOGIN' }).codigo, CODIGOS.UNAVAILABLE);
  assert.equal(traducirErrorBaseDatos({ name: 'MongoServerSelectionError' }).codigo, CODIGOS.UNAVAILABLE);
  assert.equal(traducirErrorBaseDatos(new Error('cualquier cosa')), null);
});

test('formato', () => {
  assert.equal(aFechaIso(new Date('1996-03-11T00:00:00Z')), '1996-03-11');
  assert.equal(aFechaIso('2026-11-04'), '2026-11-04');
  assert.equal(aNumero('250000.00'), 250000);
  assert.equal(aNumero(null), null);
});
