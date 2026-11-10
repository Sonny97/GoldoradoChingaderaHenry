/**
 * Piezas puras y el cliente HTTP de Wompi con un fetch falso (sin red):
 * mapeo de estados, comparacion con nuestro registro, mapeo al contrato gRPC,
 * cache de bancos, tokens SIEMPRE nuevos, timeouts -> UNAVAILABLE y 422 ->
 * INVALID_ARGUMENT con mensaje en espanol.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { diferenciasConWompi, estadoDesdeWompi, estadoLibro } from '../src/servicios/estados.js';
import { aPago } from '../src/grpc/handlers.js';
import { crearClienteWompi, mensajeErrorWompi } from '../src/wompi/cliente.js';

test('estados de Wompi -> GolDorado -> libro de MongoDB', () => {
  assert.equal(estadoDesdeWompi('PENDING'), 'PENDIENTE');
  assert.equal(estadoDesdeWompi('APPROVED'), 'APROBADO');
  assert.equal(estadoDesdeWompi('DECLINED'), 'RECHAZADO');
  assert.equal(estadoDesdeWompi('VOIDED'), 'ANULADO');
  assert.equal(estadoDesdeWompi('ERROR'), 'ERROR');
  assert.equal(estadoDesdeWompi('ALGO_NUEVO'), 'PENDIENTE', 'un estado desconocido nunca acredita');
  assert.equal(estadoLibro('APROBADO'), 'COMPLETADO');
  assert.equal(estadoLibro('RECHAZADO'), 'FALLIDO');
  assert.equal(estadoLibro('ERROR'), 'FALLIDO');
  assert.equal(estadoLibro('ANULADO'), 'REVERSADO');
  assert.equal(estadoLibro('PENDIENTE'), 'PENDIENTE');
});

test('diferenciasConWompi: referencia, centavos exactos y moneda', () => {
  const pago = { referencia: 'GD-1', montoCentavos: 5000000 };
  assert.deepEqual(diferenciasConWompi(pago, { reference: 'GD-1', amount_in_cents: 5000000, currency: 'COP' }), []);
  assert.deepEqual(diferenciasConWompi(pago, { reference: 'GD-1', amount_in_cents: '5000000', currency: 'COP' }), ['monto']);
  assert.deepEqual(diferenciasConWompi(pago, { reference: 'GD-2', amount_in_cents: 4999900, currency: 'USD' }), [
    'referencia',
    'monto',
    'moneda',
  ]);
});

test('aPago: optional sin valor se omiten y no sale nada interno', () => {
  const r = aPago({
    referencia: 'GD-1',
    idUsuario: 1,
    monto: 50000,
    moneda: 'COP',
    metodo: 'PSE',
    estado: 'PENDIENTE',
    mensajeEstado: null,
    idTransaccionWompi: null,
    acreditado: false,
    creadoEn: new Date('2026-11-10T12:00:00Z'),
    actualizadoEn: new Date('2026-11-10T12:00:00Z'),
    banco: { codigo: '1', nombre: 'Banco que aprueba' },
    pagador: { numeroDocumento: '123' },
  });
  assert.equal(r.mensajeEstado, undefined);
  assert.equal(r.idTransaccionWompi, undefined);
  assert.equal(r.urlPago, undefined);
  assert.equal(r.banco, 'Banco que aprueba');
  assert.equal(r.creadoEn, '2026-11-10T12:00:00.000Z');
  assert.equal(r.pagador, undefined);
});

function fetchFalso(respuestas) {
  const llamadas = [];
  const fn = async (url, opciones) => {
    llamadas.push({ url, opciones });
    const siguiente = respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    return {
      ok: siguiente.status >= 200 && siguiente.status < 300,
      status: siguiente.status,
      json: async () => siguiente.cuerpo,
    };
  };
  fn.llamadas = llamadas;
  return fn;
}

const INFO = {
  status: 200,
  cuerpo: {
    data: {
      presigned_acceptance: { acceptance_token: 'tok-a', permalink: 'https://wompi.co/reglamento.pdf' },
      presigned_personal_data_auth: { acceptance_token: 'tok-b', permalink: 'https://wompi.co/datos.pdf' },
    },
  },
};

const cliente = (fetch, extra = {}) =>
  crearClienteWompi({
    modo: 'sandbox',
    llavePublica: 'pub_test_1',
    llavePrivada: 'prv_test_2',
    secretoIntegridad: 'test_integrity_3',
    fetch,
    log: { aviso() {}, error() {}, info() {} },
    esperar: async () => {},
    ...extra,
  });

test('tokens de aceptacion: siempre nuevos, con x-merchant-public-key', async () => {
  const fetch = fetchFalso([INFO, INFO]);
  const w = cliente(fetch);
  const a = await w.obtenerTokensAceptacion();
  await w.obtenerTokensAceptacion();
  assert.equal(fetch.llamadas.length, 2, 'nunca se cachean');
  assert.equal(fetch.llamadas[0].url, 'https://sandbox.wompi.co/v1/merchants/info');
  assert.equal(fetch.llamadas[0].opciones.headers['x-merchant-public-key'], 'pub_test_1');
  assert.equal(a.tokenReglamento, 'tok-a');
  assert.equal(a.tokenDatosPersonales, 'tok-b');
  // Los permalinks si quedan en cache.
  assert.equal((await w.obtenerInfoComercio()).urlReglamento, 'https://wompi.co/reglamento.pdf');
  assert.equal(fetch.llamadas.length, 2);
});

test('bancos PSE: Bearer llave publica, sin el codigo 0, cache de 1 hora', async () => {
  const fetch = fetchFalso([
    {
      status: 200,
      cuerpo: {
        data: [
          { financial_institution_code: '0', financial_institution_name: 'A continuación seleccione su banco' },
          { financial_institution_code: '1', financial_institution_name: 'Banco que aprueba' },
        ],
      },
    },
  ]);
  const w = cliente(fetch);
  assert.deepEqual(await w.bancosPse(), [{ codigo: '1', nombre: 'Banco que aprueba' }]);
  await w.bancosPse();
  assert.equal(fetch.llamadas.length, 1);
  assert.equal(fetch.llamadas[0].opciones.headers.Authorization, 'Bearer pub_test_1');
});

test('crear transaccion PSE: llave privada, firma y cuerpo de docs/WOMPI.md', async () => {
  const fetch = fetchFalso([{ status: 201, cuerpo: { data: { id: '11-1', status: 'PENDING' } } }]);
  const w = cliente(fetch);
  await w.crearTransaccionPse({
    referencia: 'GD-1-1-a1b2',
    montoCentavos: 5000000,
    email: 'demo@goldorado.co',
    nombreCompleto: 'Camilo Rojas',
    telefono: '573001234567',
    tipoPersona: 0,
    tipoDocumento: 'CC',
    numeroDocumento: '1012345678',
    codigoBanco: '1',
    descripcion: 'Recarga GolDorado con un texto demasiado largo',
    urlRedireccion: 'http://localhost:3003/pagos/resultado?referencia=GD-1-1-a1b2',
    ip: '190.1.1.1',
    tokens: { tokenReglamento: 'tok-a', tokenDatosPersonales: 'tok-b' },
  });
  const { url, opciones } = fetch.llamadas[0];
  assert.equal(url, 'https://sandbox.wompi.co/v1/transactions');
  assert.equal(opciones.method, 'POST');
  assert.equal(opciones.headers.Authorization, 'Bearer prv_test_2');
  const cuerpo = JSON.parse(opciones.body);
  assert.equal(cuerpo.acceptance_token, 'tok-a');
  assert.equal(cuerpo.accept_personal_auth, 'tok-b');
  assert.equal(cuerpo.currency, 'COP');
  assert.equal(cuerpo.payment_method.type, 'PSE');
  assert.equal(cuerpo.payment_method.user_legal_id_type, 'CC');
  assert.ok(cuerpo.payment_method.payment_description.length <= 30);
  assert.match(cuerpo.signature, /^[0-9a-f]{64}$/);
  assert.equal(cuerpo.customer_data.phone_number, '573001234567');
});

test('errores de Wompi: timeout -> UNAVAILABLE, 422 -> INVALID_ARGUMENT legible, 404 -> null', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const w = cliente(
    fetchFalso([
      timeout,
      {
        status: 422,
        cuerpo: { error: { type: 'INPUT_VALIDATION_ERROR', messages: { payment_method: { user_legal_id: ['Debe tener al menos 5 caracteres'] } } } },
      },
      { status: 404, cuerpo: { error: { type: 'NOT_FOUND_ERROR' } } },
    ])
  );
  await assert.rejects(w.obtenerTransaccion('x'), (e) => e.codigo === CODIGOS.UNAVAILABLE && /Wompi no responde/.test(e.message));
  await assert.rejects(
    w.buscarPorReferencia('GD-1'),
    (e) => e.codigo === CODIGOS.INVALID_ARGUMENT && /número de documento: Debe tener al menos 5 caracteres/.test(e.message)
  );
  assert.equal(await w.obtenerTransaccion('no-existe'), null);
  assert.equal(mensajeErrorWompi({ error: { reason: 'El token de aceptación ya fue usado' } }), 'Wompi rechazó la solicitud: El token de aceptación ya fue usado');
});

test('esperarUrlPse: consulta hasta que aparece async_payment_url', async () => {
  const pendiente = { status: 200, cuerpo: { data: { id: '11-1', status: 'PENDING', payment_method: { extra: {} } } } };
  const conUrl = {
    status: 200,
    cuerpo: { data: { id: '11-1', status: 'PENDING', payment_method: { extra: { async_payment_url: 'https://banco/x' } } } },
  };
  const fetch = fetchFalso([pendiente, pendiente, conUrl]);
  const r = await cliente(fetch).esperarUrlPse('11-1');
  assert.equal(r.url, 'https://banco/x');
  assert.equal(fetch.llamadas.length, 3);
  assert.equal(fetch.llamadas[0].opciones.headers.Authorization, 'Bearer prv_test_2');
});
