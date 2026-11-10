/**
 * ObtenerImagen por un servidor y un cliente gRPC REALES (loopback): una
 * imagen de ~200 KB llega como 1 mensaje de metadatos + 4 trozos (3 de
 * 64 KB y el resto), y los bytes reconstruidos son identicos.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS, crearClienteGrpc, crearRpcSalud, crearServidorGrpc } from '@goldorado/comun';
import { puertoLibre } from '@goldorado/comun/pruebas';

import { crearAlmacenLocal } from '../src/almacenes/local.js';
import { crearHandlers } from '../src/grpc/handlers.js';
import { crearServicioImagenes } from '../src/servicios/imagenServicio.js';
import { TAMANO_TROZO } from '../src/utils/trozos.js';
import { bytesDe, carpetaTemporal, crearLogFalso } from './falsos.js';

test('streaming gRPC real: metadatos + trozos de 64 KB, bytes identicos', async () => {
  const { dir, borrar } = await carpetaTemporal();
  const log = crearLogFalso();
  const almacen = crearAlmacenLocal({ dir, log });
  const imagenes = crearServicioImagenes({ almacen, log });
  const salud = crearRpcSalud({ servicio: 'ms-imagenes', motor: 'Google Drive', baseDatos: dir, modo: 'local', comprobar: () => almacen.comprobar() });

  const servidor = crearServidorGrpc({ nombre: 'ms-imagenes', log });
  servidor.registrar('imagenes', crearHandlers({ imagenes, salud }));
  const puerto = await servidor.iniciar(await puertoLibre(), '127.0.0.1');
  const cliente = crearClienteGrpc('imagenes', { direccion: `127.0.0.1:${puerto}`, plazoMs: 10_000 });

  try {
    const original = bytesDe('png', 200 * 1024);
    const subida = await cliente.SubirImagen({
      entidad: 'jugador', idEntidad: '42', nombre: 'foto.png', tipoMime: 'image/png', contenido: original, subidoPor: 1,
    });
    assert.equal(subida.tamanoBytes, original.length);
    assert.equal(subida.idEntidad, '42');

    const mensajes = [];
    for await (const mensaje of cliente.ObtenerImagen({ id: subida.id })) mensajes.push(mensaje);

    assert.equal(mensajes[0].dato, 'metadatos');
    assert.equal(mensajes[0].metadatos.id, subida.id);
    assert.equal(mensajes[0].metadatos.tipoMime, 'image/png');
    const trozos = mensajes.slice(1);
    assert.ok(trozos.every((m) => m.dato === 'trozo'));
    assert.deepEqual(
      trozos.map((m) => m.trozo.length),
      [TAMANO_TROZO, TAMANO_TROZO, TAMANO_TROZO, original.length - 3 * TAMANO_TROZO]
    );
    assert.ok(Buffer.concat(trozos.map((m) => m.trozo)).equals(original));

    // Los demas RPC por el mismo canal
    const { imagenes: encontradas } = await cliente.BuscarImagenes({ entidad: 'jugador', idsEntidad: ['42'] });
    assert.deepEqual(encontradas.map((i) => i.id), [subida.id]);
    assert.equal((await cliente.ObtenerMetadatos({ id: subida.id })).nombre, 'foto.png');
    assert.equal((await cliente.Salud({})).estado, 'ok');

    await assert.rejects(
      cliente.SubirImagen({ entidad: 'jugador', idEntidad: '42', tipoMime: 'image/gif', contenido: Buffer.from('GIF89a') }),
      (e) => e.code === CODIGOS.INVALID_ARGUMENT && e.details === 'Solo se aceptan imágenes PNG, JPEG, WEBP o SVG'
    );

    await cliente.EliminarImagen({ id: subida.id });
    await assert.rejects(
      (async () => {
        for await (const _ of cliente.ObtenerImagen({ id: subida.id })) assert.fail('no debia llegar ningun mensaje');
      })(),
      (e) => e.code === CODIGOS.NOT_FOUND && e.details === 'Imagen no encontrada'
    );
  } finally {
    cliente.cerrar();
    await servidor.apagar(2000);
    await almacen.cerrar();
    await borrar();
  }
});
