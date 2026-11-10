/**
 * Prueba de humo obligatoria: el proceso real (node src/index.js) arranca en
 * modo sin nube (memoria + Wompi simulado) y responde por gRPC aunque
 * ms-apuestas y ms-transacciones no existan (127.0.0.1:1 rechaza al instante).
 * Un pago simulado queda APROBADO pero sin acreditar: la conciliacion lo
 * reintentara cuando ms-apuestas vuelva.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { probarArranque } from '@goldorado/comun/pruebas';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

test('arranca en memoria/simulado y atiende los RPC con los vecinos caidos', async () => {
  const { salud, proceso, cliente, detener } = await probarArranque({
    cwd: RAIZ,
    clave: 'pagos',
    env: {
      PAGOS_ALMACEN: 'memoria',
      WOMPI_MODO: 'simulado',
      MS_APUESTAS_URL: '127.0.0.1:1',
      MS_TRANSACCIONES_URL: '127.0.0.1:1',
      CONCILIACION_INTERVALO_MS: '0',
      WOMPI_SECRETO_EVENTOS: '',
    },
  });

  try {
    assert.equal(salud.servicio, 'ms-pagos');
    assert.equal(salud.motor, 'Firestore');
    assert.equal(salud.modo, 'memoria/simulado');
    assert.equal(salud.estado, 'ok');
    assert.ok(proceso.vivo());

    const conf = await cliente.ObtenerConfiguracion({});
    assert.equal(conf.modo, 'simulado');
    assert.equal(conf.montoMinimo, 5000);
    assert.deepEqual(conf.metodos, ['PSE', 'CHECKOUT']);

    const { bancos } = await cliente.ListarBancosPse({});
    assert.equal(bancos.length, 2);

    const { pagos } = await cliente.ListarPagos({ idUsuario: 1, limite: 0 });
    assert.equal(pagos[0].referencia, 'GD-SEED-0001');
    assert.equal(pagos[0].acreditado, true);

    const creado = await cliente.CrearPagoCheckout({
      idUsuario: 1,
      monto: 20000,
      pagador: { email: 'demo@goldorado.co', nombreCompleto: 'Camilo Rojas' },
      urlRetorno: 'http://localhost:3003/pagos/resultado',
    });
    assert.equal(creado.estado, 'PENDIENTE');
    assert.match(creado.urlPago, /simulado=1/);
    assert.equal(creado.idTransaccionWompi, undefined);

    const consultado = await cliente.ConsultarPago({ referencia: creado.referencia, idUsuario: 1 });
    assert.equal(consultado.estado, 'APROBADO');
    assert.equal(consultado.acreditado, false, 'ms-apuestas esta caido: se acreditara en la conciliacion');

    await assert.rejects(cliente.ConsultarPago({ referencia: creado.referencia, idUsuario: 2 }), (e) => e.code === 7);
    await assert.rejects(
      cliente.ProcesarEventoWompi({ cuerpoJson: '{"event":"transaction.updated"}', checksumCabecera: 'x' }),
      (e) => e.code === 16
    );
  } finally {
    await detener();
  }
});

test('con PAGOS_ALMACEN=firestore y sin credenciales arranca igual y Salud lo explica', async () => {
  const { salud, proceso, detener } = await probarArranque({
    cwd: RAIZ,
    clave: 'pagos',
    env: {
      PAGOS_ALMACEN: 'firestore',
      WOMPI_MODO: 'simulado',
      FIREBASE_CREDENCIALES: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      FIRESTORE_EMULATOR_HOST: '',
      MS_APUESTAS_URL: '127.0.0.1:1',
      MS_TRANSACCIONES_URL: '127.0.0.1:1',
      CONCILIACION_INTERVALO_MS: '0',
    },
  });
  try {
    assert.equal(salud.motor, 'Firestore');
    assert.equal(salud.modo, 'firestore/simulado');
    assert.equal(salud.estado, 'error');
    assert.match(salud.detalle, /credenciales de Firebase/);
    assert.ok(proceso.vivo());
  } finally {
    await detener();
  }
});
