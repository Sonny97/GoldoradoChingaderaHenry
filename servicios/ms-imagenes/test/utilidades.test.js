/**
 * Piezas sueltas: trozos de 64 KB, cache LRU por bytes, indice en memoria,
 * reintentos y requisitos de configuracion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { conReintentos, esReintentable } from '../src/utils/backoff.js';
import { crearCacheLru } from '../src/utils/cacheLru.js';
import { crearIndice } from '../src/utils/indice.js';
import { enTrozos, TAMANO_TROZO } from '../src/utils/trozos.js';
import { modoAlmacen, requisitosDrive } from '../src/config/requisitos.js';
import { errorHttp } from './falsos.js';

async function juntar(iterable) {
  const salida = [];
  for await (const x of iterable) salida.push(x);
  return salida;
}

test('enTrozos re-empaqueta pedazos irregulares en trozos de 64 KB exactos', async () => {
  const total = 3 * TAMANO_TROZO + 123;
  const original = Buffer.alloc(total, 0).map((_, i) => i % 256);
  const pedazos = [];
  for (let i = 0, n = 1; i < total; i += n, n = (n * 7) % 50_000 + 1) pedazos.push(original.subarray(i, i + n));
  const trozos = await juntar(enTrozos(pedazos));
  assert.deepEqual(trozos.map((t) => t.length), [TAMANO_TROZO, TAMANO_TROZO, TAMANO_TROZO, 123]);
  assert.ok(Buffer.concat(trozos).equals(original));
  assert.deepEqual(await juntar(enTrozos([])), []);
});

test('cache LRU: tope en bytes, saca la menos usada, no guarda lo que no cabe', () => {
  const cache = crearCacheLru({ maxBytes: 10 });
  cache.set('a', Buffer.alloc(4));
  cache.set('b', Buffer.alloc(4));
  cache.get('a'); // a pasa a ser la mas reciente
  cache.set('c', Buffer.alloc(4)); // 12 > 10: sale b
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a') && cache.get('c'));
  assert.equal(cache.bytes, 8);
  assert.equal(cache.set('enorme', Buffer.alloc(11)), false);
  assert.equal(cache.size, 2);
});

test('indice: la vigente es la mas reciente; ids vacio = todas las de la entidad', () => {
  const indice = crearIndice();
  indice.agregar({ id: 'v', entidad: 'equipo', idEntidad: '1', creadoEn: '2026-01-01T00:00:00.000Z' });
  indice.agregar({ id: 'n', entidad: 'equipo', idEntidad: '1', creadoEn: '2026-02-01T00:00:00.000Z' });
  indice.agregar({ id: 'x', entidad: 'equipo', idEntidad: '2', creadoEn: '2025-01-01T00:00:00.000Z' });
  indice.agregar({ id: 'u', entidad: 'usuario', idEntidad: '1', creadoEn: '2026-03-01T00:00:00.000Z' });
  assert.deepEqual(indice.buscar('equipo', ['1', '2', '99']).map((i) => i.id), ['n', 'x']);
  assert.deepEqual(indice.buscar('equipo', []).map((i) => i.id).sort(), ['n', 'x']);
  assert.deepEqual(indice.deEntidad('equipo', '1').map((i) => i.id), ['n', 'v']);
  indice.quitar('n');
  assert.equal(indice.buscar('equipo', ['1'])[0].id, 'v');
  assert.deepEqual(indice.buscar('torneo', []), []);
});

test('conReintentos: reintenta 429 y 403 de cuota, no un 403 de permisos', async () => {
  const esperas = [];
  const esperar = async (ms) => esperas.push(ms);
  let intentos = 0;
  const resultado = await conReintentos(async () => {
    intentos += 1;
    if (intentos === 1) throw errorHttp(429, 'rateLimitExceeded');
    if (intentos === 2) throw errorHttp(403, 'userRateLimitExceeded');
    return 'ok';
  }, { esperar });
  assert.equal(resultado, 'ok');
  assert.equal(esperas.length, 2);
  assert.ok(esperas[1] >= 2000 && esperas[1] <= 3000, 'espera exponencial 2^n s + azar');

  assert.equal(esReintentable(errorHttp(403, 'insufficientPermissions')), false);
  assert.equal(esReintentable(errorHttp(503)), true);
  await assert.rejects(conReintentos(async () => { throw errorHttp(403, 'rateLimitExceeded'); }, { max: 2, esperar }));
});

test('requisitos de configuracion de Drive segun el modo de autenticacion', () => {
  assert.deepEqual(requisitosDrive({ IMAGENES_ALMACEN: 'local' }), []);
  assert.equal(modoAlmacen({ IMAGENES_ALMACEN: 'local' }), 'local');
  assert.equal(modoAlmacen({ IMAGENES_ALMACEN: 'drive', DRIVE_AUTENTICACION: 'oauth' }), 'drive/oauth');

  const oauth = requisitosDrive({ IMAGENES_ALMACEN: 'drive', DRIVE_AUTENTICACION: 'oauth', DRIVE_OAUTH_CLIENT_ID: 'x' });
  assert.ok(oauth.some((m) => m.startsWith('DRIVE_OAUTH_CLIENT_SECRET')));
  assert.ok(oauth.some((m) => m.startsWith('DRIVE_OAUTH_REFRESH_TOKEN')));

  const cuenta = requisitosDrive({
    IMAGENES_ALMACEN: 'drive',
    DRIVE_AUTENTICACION: 'cuenta_servicio',
    GOOGLE_DRIVE_CREDENCIALES: './credenciales/drive.json',
  });
  assert.equal(cuenta.length, 1);
  assert.match(cuenta[0], /DRIVE_UNIDAD_COMPARTIDA_ID.*storageQuotaExceeded/);
});
