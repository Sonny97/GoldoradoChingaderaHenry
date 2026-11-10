/**
 * Firmas de Wompi con los vectores de docs/WOMPI.md (secciones 3 y 6).
 * El checksum de la documentacion oficial (3476DDA5...) esta mal; el correcto
 * es el que se comprueba aqui.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksumEvento, eventoValido, firmaIntegridad, sha256Hex, urlCheckout } from '../src/wompi/firmas.js';

const EVENTO_DOC = {
  event: 'transaction.updated',
  data: {
    transaction: {
      id: '1234-1610641025-49201',
      amount_in_cents: 4490000,
      reference: 'MZQ3X2DE2SMX',
      status: 'APPROVED',
    },
  },
  environment: 'prod',
  signature: {
    properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
    checksum: '5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe',
  },
  timestamp: 1530291411,
  sent_at: '2018-07-20T16:45:05.000Z',
};
const SECRETO_EVENTOS = 'prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z';

test('firma de integridad: vector oficial', () => {
  assert.equal(
    firmaIntegridad(
      { referencia: 'sk8-438k4-xmxm392-sn2m', montoCentavos: 2490000, moneda: 'COP' },
      'prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6'
    ),
    '37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5'
  );
});

test('firma de integridad: la fecha de expiracion va antes del secreto', () => {
  assert.equal(
    firmaIntegridad({ referencia: 'R1', montoCentavos: 150000, fechaExpiracion: '2026-12-01T00:00:00.000Z' }, 'sec'),
    sha256Hex('R1150000COP2026-12-01T00:00:00.000Zsec')
  );
});

test('checksum de evento: vector corregido de la documentacion', () => {
  assert.equal(checksumEvento(EVENTO_DOC, SECRETO_EVENTOS), '5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe');
  assert.equal(
    sha256Hex('1234-1610641025-49201APPROVED44900001530291411prod_events_OcHnIzeBl5socpwByQ4hA52Em3USQ93Z'),
    '5a18ec5e8fdb7df463e9f94774cba8f583ba21bd04a09ceff2ea68a4bc0aefbe'
  );
});

test('checksum: las propiedades se leen del evento (no estan fijas en el codigo)', () => {
  const otro = structuredClone(EVENTO_DOC);
  otro.signature.properties = ['transaction.reference', 'transaction.status'];
  assert.equal(checksumEvento(otro, 'x'), sha256Hex('MZQ3X2DE2SMXAPPROVED1530291411x'));
});

test('eventoValido: ignora mayusculas y acepta cabecera o signature.checksum', () => {
  const mayusculas = EVENTO_DOC.signature.checksum.toUpperCase();
  assert.equal(eventoValido(EVENTO_DOC, SECRETO_EVENTOS), true);
  assert.equal(eventoValido(EVENTO_DOC, SECRETO_EVENTOS, mayusculas), true);
  const sinFirmaEnCuerpo = { ...EVENTO_DOC, signature: { ...EVENTO_DOC.signature, checksum: '' } };
  assert.equal(eventoValido(sinFirmaEnCuerpo, SECRETO_EVENTOS, mayusculas), true);
});

test('eventoValido: rechaza firma alterada, secreto distinto o secreto vacio', () => {
  const alterado = structuredClone(EVENTO_DOC);
  alterado.data.transaction.amount_in_cents = 99900000;
  assert.equal(eventoValido(alterado, SECRETO_EVENTOS), false);
  assert.equal(eventoValido(EVENTO_DOC, 'prod_events_otro'), false);
  assert.equal(eventoValido(EVENTO_DOC, ''), false);
  assert.equal(eventoValido(EVENTO_DOC, SECRETO_EVENTOS, 'abc'), false);
});

test('urlCheckout: parametros y firma del Web Checkout', () => {
  const url = new URL(
    urlCheckout({
      llavePublica: 'pub_test_x',
      secretoIntegridad: 'test_integrity_y',
      referencia: 'GD-1-1-abcd',
      montoCentavos: 5000000,
      urlRedireccion: 'http://localhost:3003/pagos/resultado?referencia=GD-1-1-abcd',
      email: 'demo@goldorado.co',
      nombreCompleto: 'Camilo Rojas',
    })
  );
  assert.equal(url.origin + url.pathname, 'https://checkout.wompi.co/p/');
  assert.equal(url.searchParams.get('public-key'), 'pub_test_x');
  assert.equal(url.searchParams.get('currency'), 'COP');
  assert.equal(url.searchParams.get('amount-in-cents'), '5000000');
  assert.equal(url.searchParams.get('reference'), 'GD-1-1-abcd');
  assert.equal(url.searchParams.get('signature:integrity'), sha256Hex('GD-1-1-abcd5000000COPtest_integrity_y'));
  assert.equal(url.searchParams.get('redirect-url'), 'http://localhost:3003/pagos/resultado?referencia=GD-1-1-abcd');
  assert.equal(url.searchParams.get('customer-data:email'), 'demo@goldorado.co');
  assert.equal(url.searchParams.get('customer-data:full-name'), 'Camilo Rojas');
});
