/**
 * Prueba de humo obligatoria: el proceso real (node src/index.js) arranca y
 * responde Salud aunque PostgreSQL no exista. 127.0.0.1:1 rechaza la conexion
 * al instante, asi que Salud debe decir estado 'error' sin tumbar el proceso.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { probarArranque } from '@goldorado/comun/pruebas';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

test('arranca con la base inalcanzable y lo reporta en Salud', async () => {
  const { salud, proceso, detener } = await probarArranque({
    cwd: RAIZ,
    clave: 'apuestas',
    env: {
      PG_HOST: '127.0.0.1',
      PG_PORT: '1',
      PG_PASSWORD: 'clave-de-prueba',
      PG_SSL: 'false',
      MS_DEPORTES_URL: '127.0.0.1:1',
      MS_TRANSACCIONES_URL: '127.0.0.1:1',
      OUTBOX_INTERVALO_MS: '60000',
    },
  });

  try {
    assert.equal(salud.servicio, 'ms-apuestas');
    assert.equal(salud.motor, 'PostgreSQL');
    assert.equal(salud.baseDatos, 'goldorado_apuestas');
    assert.equal(salud.modo, 'local');
    assert.equal(salud.estado, 'error');
    assert.ok(salud.detalle.length > 0, 'Salud debe explicar por que la base no responde');
    assert.ok(proceso.vivo(), 'el proceso debe seguir vivo con la base caida');
  } finally {
    await detener();
  }
});
