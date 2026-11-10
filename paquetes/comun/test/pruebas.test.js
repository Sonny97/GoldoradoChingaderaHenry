/**
 * Prueba de los ayudantes de prueba: arrancar un proceso real, esperar su
 * puerto gRPC, llamar Salud y detenerlo. Es exactamente lo que hace el
 * test/arranque.test.js de cada microservicio.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { probarArranque, implementacionParcial, puertoLibre } from '../src/pruebas.js';
import { CODIGOS } from '../src/index.js';

const fixture = fileURLToPath(new URL('../fixtures/servicio-falso/', import.meta.url));

test('probarArranque levanta el proceso, responde Salud y lo detiene', async () => {
  const { salud, proceso, cliente, detener } = await probarArranque({ cwd: fixture, clave: 'transacciones' });
  try {
    assert.equal(salud.servicio, 'servicio-falso');
    assert.equal(salud.estado, 'error'); // la base es inalcanzable a proposito
    assert.ok(proceso.vivo());
    // un metodo no implementado responde UNIMPLEMENTED, no tumba el proceso
    await assert.rejects(cliente.ListarTransacciones({ idUsuario: 1 }), (e) => e.code === CODIGOS.UNIMPLEMENTED);
    assert.ok(proceso.vivo());
  } finally {
    await detener();
  }
  assert.equal(proceso.vivo(), false);
});

test('implementacionParcial completa todos los metodos del .proto', () => {
  const impl = implementacionParcial('deportes', { Salud: async () => ({}) });
  assert.ok(typeof impl.ListarEncuentros === 'function');
  assert.ok(typeof impl.ObtenerDetalleEncuentro === 'function');
});

test('puertoLibre devuelve un puerto usable', async () => {
  const p = await puertoLibre();
  assert.ok(Number.isInteger(p) && p > 0);
});
