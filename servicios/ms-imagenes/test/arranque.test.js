/**
 * Prueba de humo obligatoria: el proceso real (node src/index.js) arranca y
 * responde Salud.
 *   1. Almacen local en una carpeta temporal: estado 'ok'.
 *   2. Drive con cuenta de servicio y una llave que no existe: el proceso
 *      sigue vivo y Salud dice 'error' con la pista (no se toca la red:
 *      falla al leer la llave, antes de hablar con Google).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probarArranque } from '@goldorado/comun/pruebas';

import { carpetaTemporal } from './falsos.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

test('arranca en modo local y Salud responde ok', async () => {
  const { dir, borrar } = await carpetaTemporal();
  const { salud, proceso, cliente, detener } = await probarArranque({
    cwd: RAIZ,
    clave: 'imagenes',
    env: { IMAGENES_ALMACEN: 'local', IMAGENES_DIR_LOCAL: dir },
  });
  try {
    assert.equal(salud.servicio, 'ms-imagenes');
    assert.equal(salud.motor, 'Google Drive');
    assert.equal(salud.modo, 'local');
    assert.equal(salud.estado, 'ok', salud.detalle);
    assert.equal(salud.baseDatos, dir);
    assert.ok(proceso.vivo());
    const { imagenes } = await cliente.BuscarImagenes({ entidad: 'equipo', idsEntidad: ['1'] });
    assert.deepEqual(imagenes, []);
  } finally {
    await detener();
    await borrar();
  }
});

test('arranca con Drive mal configurado y lo reporta en Salud', async () => {
  const { dir, borrar } = await carpetaTemporal();
  const { salud, proceso, detener } = await probarArranque({
    cwd: RAIZ,
    clave: 'imagenes',
    env: {
      IMAGENES_ALMACEN: 'drive',
      DRIVE_AUTENTICACION: 'cuenta_servicio',
      GOOGLE_DRIVE_CREDENCIALES: join(dir, 'no-existe.json'),
      DRIVE_UNIDAD_COMPARTIDA_ID: '0AunidadDePrueba',
      DRIVE_CARPETA_RAIZ_ID: '',
    },
  });
  try {
    assert.equal(salud.modo, 'drive/cuenta_servicio');
    assert.equal(salud.estado, 'error');
    assert.match(salud.detalle, /credenciales de Google Drive.*GOOGLE_DRIVE_CREDENCIALES/);
    assert.ok(proceso.vivo(), 'el proceso debe seguir vivo con Drive inalcanzable');
  } finally {
    await detener();
    await borrar();
  }
});
