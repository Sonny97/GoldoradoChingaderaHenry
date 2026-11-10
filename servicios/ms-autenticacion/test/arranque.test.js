/**
 * El servicio ARRANCA con SQL Server inalcanzable y lo reporta en Salud.
 *
 * Es la regla del monolito (/api/salud con la base caida) llevada a gRPC: el
 * proceso no se cae, abre su puerto y Salud responde 'error' con el motivo.
 * Base en 127.0.0.1:1 (nadie escucha ahi) y sin ms-transacciones.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probarArranque } from '@goldorado/comun/pruebas';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

test('arranca sin base de datos y Salud lo reporta', { timeout: 40000 }, async () => {
  const { salud, proceso, detener } = await probarArranque({
    cwd: raiz,
    clave: 'autenticacion',
    env: {
      DB_SERVER: '127.0.0.1',
      DB_PORT: '1',
      DB_PASSWORD: 'no-importa',
      JWT_SECRET: 'x'.repeat(40),
      MS_TRANSACCIONES_URL: 'apagado',
      NODE_ENV: 'development',
    },
  });
  try {
    assert.equal(salud.servicio, 'ms-autenticacion');
    assert.equal(salud.motor, 'SQL Server');
    assert.equal(salud.baseDatos, 'GolDoradoAuth');
    assert.equal(salud.estado, 'error');
    assert.ok(salud.detalle.length > 0, 'Salud debe explicar por que la base no responde');
    assert.ok(proceso.vivo(), 'el proceso debe seguir vivo con la base caida');
  } finally {
    await detener();
  }
});
