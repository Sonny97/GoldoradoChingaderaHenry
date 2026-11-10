/**
 * Reglas de negocio de ms-pagos con el repositorio en memoria y dobles de
 * ms-apuestas / ms-transacciones (sin red ni Firebase).
 *
 * Lo mas importante que se prueba: el saldo se acredita UNA sola vez aunque
 * el pago se consulte varias veces y ademas llegue el webhook; una transaccion
 * que no coincide con nuestro registro nunca acredita; una segunda aprobacion
 * con la misma referencia queda para revision manual.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { crearRepoPagosMemoria } from '../src/repositorios/pagoRepoMemoria.js';
import { crearServicioPagos, MENSAJE_CONSENTIMIENTO } from '../src/servicios/pagoServicio.js';
import { crearPasarelaSimulada } from '../src/wompi/simulado.js';
import {
  SECRETO_EVENTOS,
  apuestasFalso,
  eventoFirmado,
  logMudo,
  pasarelaFalsa,
  solicitudPse,
  transaccionesFalso,
} from './falsos.js';

function montar({ simulado = false, config = {}, apuestas = apuestasFalso(), transacciones = transaccionesFalso() } = {}) {
  const repo = crearRepoPagosMemoria();
  const pasarela = simulado ? crearPasarelaSimulada({ obtenerPago: (r) => repo.obtener(r) }) : pasarelaFalsa();
  const log = logMudo();
  const servicio = crearServicioPagos({
    repo,
    pasarela,
    apuestas,
    transacciones,
    log,
    config: { montoMinimo: 5000, montoMaximo: 3000000, secretoEventos: SECRETO_EVENTOS, ...config },
  });
  return { repo, pasarela, servicio, apuestas, transacciones, log };
}

const conCodigo = (codigo, mensaje) => (error) => {
  assert.equal(error.codigo, codigo, `codigo esperado ${codigo}, llego ${error.codigo}: ${error.message}`);
  if (mensaje) assert.match(error.message, mensaje);
  return true;
};

test('flujo simulado PSE: crear -> consultar -> webhook acredita exactamente una vez', async () => {
  const { servicio, apuestas, transacciones, repo, pasarela } = montar({ simulado: true });

  const creado = await servicio.crearPagoPse(solicitudPse());
  assert.match(creado.referencia, /^GD-1-\d{13}-[0-9a-f]{4}$/);
  assert.equal(creado.estado, 'PENDIENTE');
  assert.equal(creado.montoCentavos, 5000000);
  assert.equal(creado.idTransaccionWompi, `SIM-${creado.referencia}`);
  const url = new URL(creado.urlPago);
  assert.equal(url.searchParams.get('referencia'), creado.referencia);
  assert.equal(url.searchParams.get('simulado'), '1');
  assert.equal(creado.banco.nombre, 'Banco que aprueba (simulado)');
  assert.equal(transacciones.libro.get(creado.referencia).estado, 'PENDIENTE');
  assert.equal(transacciones.libro.get(creado.referencia).tipo, 'DEPOSITO');

  const consultado = await servicio.consultarPago({ referencia: creado.referencia, idUsuario: 1 });
  assert.equal(consultado.estado, 'APROBADO');
  assert.equal(consultado.acreditado, true);

  const otraVez = await servicio.consultarPago({ referencia: creado.referencia, idUsuario: 1 });
  assert.equal(otraVez.estado, 'APROBADO');

  const tx = await pasarela.obtenerTransaccion(creado.idTransaccionWompi);
  const evento = eventoFirmado(tx);
  const r = await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(evento), checksumCabecera: '' });
  assert.deepEqual(r, { aceptado: true, referencia: creado.referencia, estado: 'APROBADO' });

  // El mismo evento reintentado por Wompi se deduplica.
  const repetido = await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(evento), checksumCabecera: '' });
  assert.equal(repetido.aceptado, true);

  assert.equal(apuestas.llamadas.length, 1, 'AcreditarDeposito se llama una sola vez');
  assert.equal(apuestas.saldos.get(1), 50000);
  assert.deepEqual(apuestas.llamadas[0], {
    idUsuario: 1,
    monto: 50000,
    referencia: creado.referencia,
    proveedor: 'Wompi',
    metodo: 'PSE',
    idTransaccionPasarela: `SIM-${creado.referencia}`,
  });
  const libro = transacciones.libro.get(creado.referencia);
  assert.equal(libro.estado, 'COMPLETADO');
  assert.deepEqual(libro.historial, ['PENDIENTE', 'COMPLETADO']);

  const eventos = await repo.listarEventos(creado.referencia);
  assert.ok(eventos.some((e) => e.tipo === 'ACREDITADO'));
  assert.ok(eventos.some((e) => e.origen === 'WEBHOOK'));
});

test('flujo simulado PSE con el banco 2: RECHAZADO, sin acreditar, libro FALLIDO', async () => {
  const { servicio, apuestas, transacciones } = montar({ simulado: true });
  const creado = await servicio.crearPagoPse(solicitudPse({ codigoBanco: '2' }));
  const pago = await servicio.consultarPago({ referencia: creado.referencia, idUsuario: 1 });
  assert.equal(pago.estado, 'RECHAZADO');
  assert.equal(pago.acreditado, false);
  assert.equal(apuestas.llamadas.length, 0);
  assert.equal(transacciones.libro.get(creado.referencia).estado, 'FALLIDO');
});

test('flujo simulado Web Checkout: URL de retorno directa y consulta por referencia', async () => {
  const { servicio, apuestas } = montar({ simulado: true });
  const creado = await servicio.crearPagoCheckout({
    idUsuario: 2,
    monto: 20000,
    pagador: { email: 'valentina.mesa@hotmail.com', nombreCompleto: 'Valentina Mesa' },
    urlRetorno: 'http://localhost:3003/pagos/resultado',
  });
  assert.equal(creado.metodo, 'CHECKOUT');
  assert.equal(
    creado.urlPago,
    `http://localhost:3003/pagos/resultado?referencia=${creado.referencia}&simulado=1`
  );
  const pago = await servicio.consultarPago({ referencia: creado.referencia, idUsuario: 2 });
  assert.equal(pago.estado, 'APROBADO');
  assert.equal(pago.medioWompi, 'NEQUI');
  assert.equal(apuestas.llamadas.length, 1);
  assert.equal(apuestas.llamadas[0].metodo, 'NEQUI');
});

test('PSE real: tokens nuevos, cuerpo correcto, URL del banco y libro PENDIENTE', async () => {
  const { servicio, pasarela, transacciones } = montar();
  await servicio.crearPagoPse(solicitudPse());
  const pago = await servicio.crearPagoPse(solicitudPse({ monto: 10000 }));
  assert.equal(pasarela.tokensPedidos, 2, 'un juego de tokens por transaccion');
  const enviado = pasarela.ultimaCreacion;
  assert.equal(enviado.montoCentavos, 1000000);
  assert.equal(enviado.telefono, '573001234567');
  assert.equal(enviado.descripcion, 'Recarga GolDorado');
  assert.equal(enviado.ip, '190.1.2.3');
  assert.equal(enviado.urlRedireccion, `http://localhost:3003/pagos/resultado?referencia=${pago.referencia}`);
  assert.equal(enviado.tokens.tokenReglamento, 'tok-2');
  assert.equal(pago.urlPago, `https://banco.test/pse?ticket=${pago.idTransaccionWompi}`);
  assert.equal(pago.estado, 'PENDIENTE');
  assert.equal(transacciones.libro.get(pago.referencia).proveedor, 'Wompi');
  assert.equal(transacciones.libro.get(pago.referencia).ejecutadoPor, 'MS_PAGOS');
});

test('monto o referencia que no coinciden: no acredita, ERROR y evento CRITICO', async () => {
  const { servicio, pasarela, apuestas, transacciones } = montar();
  const pago = await servicio.crearPagoPse(solicitudPse());
  pasarela.poner(pago.idTransaccionWompi, { status: 'APPROVED', amount_in_cents: 100 });
  const r = await servicio.consultarPago({ referencia: pago.referencia, idUsuario: 1 });
  assert.equal(r.estado, 'ERROR');
  assert.equal(r.acreditado, false);
  assert.equal(apuestas.llamadas.length, 0);
  const evento = transacciones.eventos.find((e) => e.tipo === 'PAGO_MONTO_INCONSISTENTE');
  assert.equal(evento.severidad, 'CRITICO');
  assert.deepEqual(JSON.parse(evento.detalle).diferencias, ['monto']);

  const otro = await servicio.crearPagoPse(solicitudPse());
  pasarela.poner(otro.idTransaccionWompi, { status: 'APPROVED', reference: 'GD-1-OTRA' });
  const r2 = await servicio.consultarPago({ referencia: otro.referencia });
  assert.equal(r2.estado, 'ERROR');
  assert.equal(apuestas.llamadas.length, 0);
});

test('segunda transaccion APPROVED con la misma referencia: no se acredita y queda en revision', async () => {
  const { servicio, pasarela, apuestas, transacciones, repo } = montar();
  const pago = await servicio.crearPagoCheckout({ idUsuario: 1, monto: 50000, pagador: {}, urlRetorno: 'http://localhost:3003/r' });
  const base = { reference: pago.referencia, amount_in_cents: 5000000, currency: 'COP', payment_method_type: 'CARD' };
  pasarela.agregar({ ...base, id: 'A-1', status: 'DECLINED', created_at: '2026-11-10T10:00:00Z' });
  pasarela.agregar({ ...base, id: 'A-2', status: 'APPROVED', created_at: '2026-11-10T10:01:00Z' });

  // Vuelve del checkout con ?id=A-2 (el reintento aprobado).
  const aprobado = await servicio.consultarPago({ idTransaccionWompi: 'A-2', idUsuario: 1 });
  assert.equal(aprobado.estado, 'APROBADO');
  assert.equal(aprobado.acreditado, true);

  // Un webhook tardio de la DECLINED no baja el estado.
  await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(eventoFirmado({ ...base, id: 'A-1', status: 'DECLINED' })), checksumCabecera: '' });
  assert.equal((await repo.obtener(pago.referencia)).estado, 'APROBADO');

  // Y una tercera aprobada con la misma referencia se marca, no se acredita.
  pasarela.agregar({ ...base, id: 'A-3', status: 'APPROVED', created_at: '2026-11-10T10:05:00Z' });
  const r = await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(eventoFirmado({ ...base, id: 'A-3', status: 'APPROVED' })), checksumCabecera: '' });
  assert.equal(r.estado, 'APROBADO');
  assert.equal(apuestas.llamadas.length, 1);
  const guardado = await repo.obtener(pago.referencia);
  assert.deepEqual(guardado.aprobacionesDuplicadas, ['A-3']);
  assert.equal(guardado.idTransaccionAprobada, 'A-2');
  const evento = transacciones.eventos.find((e) => e.tipo === 'PAGO_DUPLICADO_REVISION');
  assert.equal(evento.severidad, 'ADVERTENCIA');
});

test('un usuario no puede consultar el pago de otro', async () => {
  const { servicio } = montar({ simulado: true });
  await assert.rejects(
    servicio.consultarPago({ referencia: 'GD-SEED-0001', idUsuario: 2 }),
    conCodigo(CODIGOS.PERMISSION_DENIED, /No puedes consultar ese pago/)
  );
  const propio = await servicio.consultarPago({ referencia: 'GD-SEED-0001', idUsuario: 1 });
  assert.equal(propio.estado, 'APROBADO');
  const sistema = await servicio.consultarPago({ referencia: 'GD-SEED-0002', idUsuario: 0 });
  assert.equal(sistema.idUsuario, 2);
  await assert.rejects(servicio.consultarPago({ referencia: 'GD-NO-EXISTE' }), conCodigo(CODIGOS.NOT_FOUND));
});

test('sin las dos casillas de Wompi no se crea el pago PSE', async () => {
  const { servicio, pasarela } = montar();
  for (const extra of [{ aceptaReglamento: false }, { aceptaDatosPersonales: false }, { aceptaReglamento: undefined }]) {
    await assert.rejects(
      servicio.crearPagoPse(solicitudPse(extra)),
      conCodigo(CODIGOS.INVALID_ARGUMENT, new RegExp(MENSAJE_CONSENTIMIENTO))
    );
  }
  assert.equal(pasarela.tokensPedidos, 0);
});

test('validaciones: monto entero dentro de limites (nunca menos de $1.500) y datos del pagador', async () => {
  const { servicio } = montar({ simulado: true });
  for (const monto of [4999, 3000001, 10000.5, 0, -1]) {
    await assert.rejects(servicio.crearPagoPse(solicitudPse({ monto })), conCodigo(CODIGOS.INVALID_ARGUMENT, /monto/));
  }
  await assert.rejects(servicio.crearPagoPse(solicitudPse({ tipoPersona: 3 })), conCodigo(CODIGOS.INVALID_ARGUMENT));
  await assert.rejects(servicio.crearPagoPse(solicitudPse({ codigoBanco: '' })), conCodigo(CODIGOS.INVALID_ARGUMENT));
  await assert.rejects(servicio.crearPagoPse(solicitudPse({ codigoBanco: '99' })), conCodigo(CODIGOS.INVALID_ARGUMENT, /banco/));
  await assert.rejects(
    servicio.crearPagoPse(solicitudPse({ pagador: { ...solicitudPse().pagador, email: 'no-es-correo' } })),
    conCodigo(CODIGOS.INVALID_ARGUMENT, /correo/)
  );
  await assert.rejects(
    servicio.crearPagoPse(solicitudPse({ pagador: { ...solicitudPse().pagador, tipoDocumento: 'XX' } })),
    conCodigo(CODIGOS.INVALID_ARGUMENT, /documento/)
  );
  await assert.rejects(servicio.crearPagoPse(solicitudPse({ urlRetorno: 'javascript:alert(1)' })), conCodigo(CODIGOS.INVALID_ARGUMENT));

  const barato = montar({ simulado: true, config: { montoMinimo: 100 } });
  const conf = await barato.servicio.obtenerConfiguracion();
  assert.equal(conf.montoMinimo, 1500);
  await assert.rejects(barato.servicio.crearPagoPse(solicitudPse({ monto: 1000 })), conCodigo(CODIGOS.INVALID_ARGUMENT));
});

test('ObtenerConfiguracion: llave publica, limites y permalinks (vacios en simulado)', async () => {
  const simulado = await montar({ simulado: true }).servicio.obtenerConfiguracion();
  assert.equal(simulado.modo, 'simulado');
  assert.equal(simulado.urlReglamento, '');
  assert.deepEqual(simulado.metodos, ['PSE', 'CHECKOUT']);
  assert.deepEqual(simulado.montosSugeridos, [20000, 50000, 100000, 200000]);

  const { servicio, pasarela } = montar();
  const real = await servicio.obtenerConfiguracion();
  assert.equal(real.llavePublica, 'pub_test_falsa');
  assert.equal(real.urlDatosPersonales, 'https://wompi.co/datos.pdf');
  pasarela.obtenerInfoComercio = async () => {
    throw new Error('sin red');
  };
  const sinWompi = await servicio.obtenerConfiguracion();
  assert.equal(sinWompi.urlReglamento, '', 'nunca falla por Wompi');
  assert.equal(sinWompi.montoMaximo, 3000000);
});

test('webhook con firma invalida: UNAUTHENTICATED y evento de seguridad CRITICO', async () => {
  const { servicio, transacciones } = montar({ simulado: true });
  const evento = eventoFirmado({ id: 'SIM-GD-SEED-0001', status: 'APPROVED', amount_in_cents: 30000000 }, { secreto: 'otro' });
  await assert.rejects(
    servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(evento), checksumCabecera: evento.signature.checksum }),
    conCodigo(CODIGOS.UNAUTHENTICATED)
  );
  const seguridad = transacciones.eventos.find((e) => e.tipo === 'WEBHOOK_FIRMA_INVALIDA');
  assert.equal(seguridad.severidad, 'CRITICO');
  assert.equal(seguridad.origen, 'ms-pagos');
  await assert.rejects(servicio.procesarEventoWompi({ cuerpoJson: '{no json', checksumCabecera: '' }), conCodigo(CODIGOS.INVALID_ARGUMENT));
});

test('webhook de otro ambiente u otro tipo de evento: aceptado e ignorado', async () => {
  const { servicio, apuestas, pasarela } = montar();
  const prod = eventoFirmado({ id: 'X-1', status: 'APPROVED', amount_in_cents: 1, reference: 'R' }, { environment: 'prod' });
  assert.deepEqual(await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(prod), checksumCabecera: '' }), {
    aceptado: true,
    referencia: 'R',
    estado: '',
  });
  const nequi = { ...eventoFirmado({ id: 'X-2' }), event: 'nequi_token.updated' };
  const r = await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(nequi), checksumCabecera: '' });
  assert.equal(r.aceptado, true);
  // Referencia que no es nuestra: aceptado (200) pero sin efecto.
  const ajena = { id: 'X-3', reference: 'OTRO-COMERCIO-1', amount_in_cents: 500000, currency: 'COP', status: 'APPROVED' };
  pasarela.agregar(ajena);
  const r2 = await servicio.procesarEventoWompi({ cuerpoJson: JSON.stringify(eventoFirmado(ajena)), checksumCabecera: '' });
  assert.deepEqual(r2, { aceptado: true, referencia: 'OTRO-COMERCIO-1', estado: '' });
  assert.equal(apuestas.llamadas.length, 0);
});

test('webhook con ms-apuestas caido: UNAVAILABLE (Wompi reintenta) y la conciliacion acredita', async () => {
  const apuestas = apuestasFalso({ fallar: true });
  const { servicio, pasarela, repo } = montar({ apuestas });
  const pago = await servicio.crearPagoPse(solicitudPse());
  pasarela.poner(pago.idTransaccionWompi, { status: 'APPROVED' });
  const cuerpo = JSON.stringify(eventoFirmado(await pasarela.obtenerTransaccion(pago.idTransaccionWompi)));

  await assert.rejects(servicio.procesarEventoWompi({ cuerpoJson: cuerpo, checksumCabecera: '' }), conCodigo(CODIGOS.UNAVAILABLE));
  const guardado = await repo.obtener(pago.referencia);
  assert.equal(guardado.estado, 'APROBADO');
  assert.equal(guardado.acreditado, false);

  apuestas.fallar = false;
  const resumen = await servicio.conciliar();
  assert.equal(resumen.acreditados, 1);
  assert.equal((await repo.obtener(pago.referencia)).acreditado, true);
  // El reintento de Wompi ya no acredita otra vez (no estaba marcado como procesado, pero es idempotente).
  const r = await servicio.procesarEventoWompi({ cuerpoJson: cuerpo, checksumCabecera: '' });
  assert.equal(r.estado, 'APROBADO');
  assert.equal(apuestas.saldos.get(1), 50000);
});

test('Wompi rechaza la creacion (422): pago en ERROR y error legible', async () => {
  const { servicio, pasarela, repo, transacciones } = montar();
  const { invalido } = await import('@goldorado/comun');
  pasarela.crearTransaccionPse = async () => {
    throw invalido('Wompi rechazó la solicitud: número de documento: Debe tener al menos 5 caracteres');
  };
  await assert.rejects(servicio.crearPagoPse(solicitudPse()), conCodigo(CODIGOS.INVALID_ARGUMENT, /número de documento/));
  const [pago] = (await repo.listarPorUsuario(1)).filter((p) => p.referencia.startsWith('GD-1-'));
  assert.equal(pago.estado, 'ERROR');
  assert.match(pago.mensajeEstado, /Wompi rechazó/);
  assert.equal(transacciones.libro.get(pago.referencia).estado, 'FALLIDO');
});

test('libro de Mongo caido: el pago sigue, queda libroPendiente y la conciliacion lo registra', async () => {
  const transacciones = transaccionesFalso({ fallar: true });
  const { servicio, repo } = montar({ simulado: true, transacciones });
  const pago = await servicio.crearPagoCheckout({ idUsuario: 1, monto: 20000, pagador: {}, urlRetorno: 'http://localhost:3003/r' });
  assert.equal(pago.libroPendiente, true);
  transacciones.fallar = false;
  const resumen = await servicio.conciliar();
  assert.equal(resumen.libro, 1);
  const guardado = await repo.obtener(pago.referencia);
  assert.equal(guardado.libroPendiente, false);
  assert.equal(transacciones.libro.get(pago.referencia).estado, 'PENDIENTE');
});

test('conciliacion: PENDIENTE de mas de 2 minutos se resuelve contra Wompi', async () => {
  let reloj = new Date('2026-11-10T12:00:00Z');
  const repo = crearRepoPagosMemoria({ semilla: false, ahora: () => reloj });
  const pasarela = crearPasarelaSimulada({ obtenerPago: (r) => repo.obtener(r) });
  const apuestas = apuestasFalso();
  const servicio = crearServicioPagos({
    repo,
    pasarela,
    apuestas,
    transacciones: transaccionesFalso(),
    log: logMudo(),
    config: { secretoEventos: SECRETO_EVENTOS },
    ahora: () => reloj,
  });
  const pago = await servicio.crearPagoPse(solicitudPse());
  assert.equal((await servicio.conciliar()).revisados, 0, 'recien creado: todavia no');
  reloj = new Date(reloj.getTime() + 3 * 60 * 1000);
  assert.equal((await servicio.conciliar()).revisados, 1);
  const guardado = await repo.obtener(pago.referencia);
  assert.equal(guardado.estado, 'APROBADO');
  assert.equal(guardado.acreditado, true);
  assert.equal(apuestas.llamadas.length, 1);
});
