/**
 * El servicio ARRANCA aunque MySQL no exista (puerto 1 en 127.0.0.1) y lo dice
 * en Salud. Es la regla del monolito: la base caida no tumba el proceso.
 *
 * Se levanta el proceso real (node src/index.js) y se le habla por gRPC.
 */

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CODIGOS } from '@goldorado/comun';
import { probarArranque } from '@goldorado/comun/pruebas';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

it('arranca sin MySQL, responde Salud con el error y sirve lo que no necesita base', async () => {
  const { salud, proceso, cliente, detener } = await probarArranque({
    cwd: RAIZ,
    clave: 'deportes',
    env: {
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '1',
      MYSQL_USER: 'prueba',
      MYSQL_PASSWORD: 'prueba',
      MYSQL_DATABASE: 'goldorado_deportes',
      MYSQL_SSL: 'false',
    },
  });

  try {
    assert.equal(salud.servicio, 'ms-deportes');
    assert.equal(salud.motor, 'MySQL');
    assert.equal(salud.baseDatos, 'goldorado_deportes');
    assert.equal(salud.estado, 'error');
    assert.ok(salud.detalle.length > 0, 'Salud debe decir por que fallo');
    assert.ok(proceso.vivo(), 'el proceso debe seguir vivo con la base caida');

    // Un estado invalido se resuelve sin tocar la base.
    const vacia = await cliente.ListarEncuentros({ estado: 'esports' });
    assert.deepEqual(vacia.encuentros, []);

    // Lo que si necesita base responde UNAVAILABLE, sin filtrar el texto del driver.
    await assert.rejects(cliente.ObtenerEncuentro({ id: 1 }), (error) => {
      assert.equal(error.code, CODIGOS.UNAVAILABLE);
      assert.doesNotMatch(error.details, /ECONNREFUSED|127\.0\.0\.1/);
      return true;
    });

    assert.ok(proceso.vivo());
  } finally {
    await detener();
  }
});
