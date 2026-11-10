// =============================================================================
//  Prueba obligatoria de arranque: el proceso real (node src/index.js) debe
//  levantar y responder Salud AUNQUE MongoDB no exista. El puerto 1 de
//  127.0.0.1 rechaza la conexion al instante: es "Mongo caido" sin red real.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CODIGOS } from '@goldorado/comun';
import { probarArranque } from '@goldorado/comun/pruebas';

const raiz = fileURLToPath(new URL('..', import.meta.url));

test('arranca sin MongoDB, lo dice en Salud y responde UNAVAILABLE sin colgarse', async () => {
  const { salud, proceso, cliente, detener } = await probarArranque({
    cwd: raiz,
    clave: 'transacciones',
    env: {
      MONGO_URI: 'mongodb://127.0.0.1:1',
      MONGO_DB: 'goldorado_transacciones_prueba',
      LOGS_SESION_DIAS: '180',
    },
  });
  try {
    assert.equal(salud.servicio, 'ms-transacciones');
    assert.equal(salud.motor, 'MongoDB');
    assert.equal(salud.baseDatos, 'goldorado_transacciones_prueba');
    assert.equal(salud.estado, 'error');
    assert.ok(salud.detalle.length > 0, 'Salud debe explicar por que fallo');
    assert.ok(proceso.vivo());

    // La validacion responde aunque no haya base (no la necesita)...
    await assert.rejects(
      cliente.RegistrarIntentoSesion({ emailIntento: 'x@goldorado.co', ip: '1.1.1.1', exitoso: false, proveedor: 'LOCAL' }),
      (error) => error.code === CODIGOS.INVALID_ARGUMENT
    );
    // ...y lo que si la necesita falla rapido como UNAVAILABLE.
    await assert.rejects(
      cliente.ObtenerTransaccion({ codigo: 'GD-SEED-0001' }),
      (error) => error.code === CODIGOS.UNAVAILABLE
    );
    assert.ok(proceso.vivo(), 'el proceso no debe caerse por la base');
  } finally {
    await detener();
  }
});
