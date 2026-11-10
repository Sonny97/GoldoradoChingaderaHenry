/**
 * Almacen local de punta a punta a traves del servicio:
 * subir -> buscar -> stream con bytes identicos -> reemplazar deja solo la
 * nueva -> eliminar -> NOT_FOUND. Ademas: persistencia del indice en disco
 * y que un id con forma de ruta nunca llegue al sistema de archivos.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CODIGOS } from '@goldorado/comun';

import { crearAlmacenLocal } from '../src/almacenes/local.js';
import { crearServicioImagenes } from '../src/servicios/imagenServicio.js';
import { TAMANO_TROZO } from '../src/utils/trozos.js';
import { bytesDe, carpetaTemporal, crearCtxFalso, crearLogFalso } from './falsos.js';

function armar(dir) {
  const log = crearLogFalso();
  const almacen = crearAlmacenLocal({ dir, log });
  return { almacen, log, imagenes: crearServicioImagenes({ almacen, log }) };
}

const conCodigo = (codigo) => (error) => {
  assert.equal(error.codigo, codigo, error.message);
  return true;
};

test('local: subir, buscar, transmitir, reemplazar, eliminar', async () => {
  const { dir, borrar } = await carpetaTemporal();
  try {
    const { almacen, imagenes } = armar(dir);
    await almacen.iniciar();

    const original = bytesDe('png', 150_000);
    const primera = await imagenes.subir({
      entidad: 'usuario', idEntidad: '7', nombre: 'yo.png', tipoMime: 'image/png', contenido: original, subidoPor: 7,
    });
    assert.match(primera.id, /^[0-9a-f]{32}$/);
    assert.equal(primera.tamanoBytes, original.length);
    assert.equal(primera.entidad, 'usuario');
    assert.equal(primera.idEntidad, '7');
    assert.ok(!Number.isNaN(Date.parse(primera.creadoEn)));
    assert.match(primera.descripcion, /usuario 7/);

    // buscar
    const [encontrada] = await imagenes.buscar({ entidad: 'usuario', idsEntidad: ['7', '8'] });
    assert.equal(encontrada.id, primera.id);
    assert.equal((await imagenes.buscar({ entidad: 'usuario', idsEntidad: [] })).length, 1);

    // stream: metadatos primero, luego trozos de 64 KB, bytes identicos
    const ctx = crearCtxFalso();
    await imagenes.transmitir(primera.id, ctx);
    assert.equal(ctx.mensajes[0].metadatos.id, primera.id);
    const trozos = ctx.mensajes.slice(1).map((m) => m.trozo);
    assert.deepEqual(trozos.map((t) => t.length), [TAMANO_TROZO, TAMANO_TROZO, 150_000 - 2 * TAMANO_TROZO]);
    assert.ok(Buffer.concat(trozos).equals(original));

    // reemplazar: queda SOLO la nueva (en el indice y en disco)
    const segunda = await imagenes.subir({
      entidad: 'usuario', idEntidad: '7', nombre: 'nueva.jpg', tipoMime: 'image/jpeg', contenido: bytesDe('jpeg', 2000), reemplazar: true,
    });
    assert.deepEqual((await almacen.imagenesDe('usuario', '7')).map((i) => i.id), [segunda.id]);
    assert.equal((await imagenes.buscar({ entidad: 'usuario', idsEntidad: ['7'] }))[0].id, segunda.id);
    await assert.rejects(imagenes.metadatos(primera.id), conCodigo(CODIGOS.NOT_FOUND));
    assert.deepEqual(await readdir(join(dir, 'archivos')), [`${segunda.id}.jpg`]);

    // sin reemplazar se acumulan, y la vigente es la mas reciente
    const tercera = await imagenes.subir({ entidad: 'usuario', idEntidad: '7', tipoMime: 'image/webp', contenido: bytesDe('webp') });
    assert.equal(tercera.nombre, 'usuario-7.webp');
    assert.equal((await imagenes.buscar({ entidad: 'usuario', idsEntidad: ['7'] }))[0].id, tercera.id);

    // el indice quedo en disco: otro almacen sobre la misma carpeta lo ve
    const json = JSON.parse(await readFile(join(dir, 'indice.json'), 'utf8'));
    assert.equal(Object.keys(json.imagenes).length, 2);
    const otro = armar(dir);
    assert.equal((await otro.imagenes.metadatos(segunda.id)).nombre, 'nueva.jpg');

    // eliminar -> NOT_FOUND en todo
    await imagenes.eliminar(segunda.id);
    await assert.rejects(imagenes.metadatos(segunda.id), conCodigo(CODIGOS.NOT_FOUND));
    await assert.rejects(imagenes.transmitir(segunda.id, crearCtxFalso()), conCodigo(CODIGOS.NOT_FOUND));
    await assert.rejects(imagenes.eliminar(segunda.id), conCodigo(CODIGOS.NOT_FOUND));
    assert.equal((await imagenes.buscar({ entidad: 'usuario', idsEntidad: ['7'] }))[0].id, tercera.id);

    await almacen.comprobar();
    await almacen.cerrar();
  } finally {
    await borrar();
  }
});

test('local: ids con forma de ruta y entradas invalidas', async () => {
  const { dir, borrar } = await carpetaTemporal();
  try {
    const { imagenes } = armar(dir);
    for (const id of ['..\\..\\.env', '../indice', 'ABC', `${'a'.repeat(31)}/`]) {
      await assert.rejects(imagenes.metadatos(id), conCodigo(CODIGOS.NOT_FOUND));
      await assert.rejects(imagenes.eliminar(id), conCodigo(CODIGOS.NOT_FOUND));
    }
    await assert.rejects(imagenes.metadatos(''), conCodigo(CODIGOS.INVALID_ARGUMENT));
    await assert.rejects(imagenes.buscar({ entidad: 'partido' }), conCodigo(CODIGOS.INVALID_ARGUMENT));
    await assert.rejects(
      imagenes.subir({ entidad: 'equipo', idEntidad: '1', tipoMime: 'image/jpeg', contenido: bytesDe('png') }),
      (e) => e.codigo === CODIGOS.INVALID_ARGUMENT && e.message === 'El contenido no corresponde a una imagen JPEG válida'
    );
  } finally {
    await borrar();
  }
});

test('local: un cliente que cancela corta el envio', async () => {
  const { dir, borrar } = await carpetaTemporal();
  try {
    const { imagenes } = armar(dir);
    const img = await imagenes.subir({ entidad: 'promocion', idEntidad: '3', tipoMime: 'image/png', contenido: bytesDe('png', 500_000) });
    const ctx = crearCtxFalso({ cancelarTras: 2 }); // metadatos + 1 trozo
    await imagenes.transmitir(img.id, ctx);
    assert.equal(ctx.mensajes.length, 2);
  } finally {
    await borrar();
  }
});
