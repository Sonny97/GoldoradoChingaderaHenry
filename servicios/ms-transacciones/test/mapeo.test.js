// =============================================================================
//  Documento de Mongo <-> mensaje del .proto: Decimal128, Long, fechas,
//  optional ausentes e idUsuario null a proposito.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal128, Long } from 'mongodb';
import {
  aDecimal,
  aDocumentoEvento,
  aDocumentoIntento,
  aDocumentoTransaccion,
  aEntero,
  eventoAMensaje,
  transaccionAMensaje,
} from '../src/utils/mapeo.js';
import { validarRegistro } from '../src/servicios/transacciones.js';

const creado = new Date('2026-11-05T14:12:00.000Z');
const aprobado = new Date('2026-11-05T14:13:00.000Z');

test('transaccionAMensaje: Decimal128 y Long a number, Date a ISO, null y ausentes se omiten', () => {
  const mensaje = transaccionAMensaje({
    _id: 'interno',
    codigo: 'GD-SEED-0001',
    idUsuario: Long.fromNumber(1),
    tipo: 'DEPOSITO',
    estado: 'COMPLETADO',
    monto: Decimal128.fromString('300000.00'),
    moneda: 'COP',
    origen: 'ms-pagos',
    referenciaExterna: 'WOMPI-2026-0001',
    proveedor: 'Wompi',
    creadoEn: creado,
    actualizadoEn: aprobado,
    historial: [
      { estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: creado, ejecutadoPor: 'SISTEMA' },
      { estadoAnterior: 'PENDIENTE', estadoNuevo: 'COMPLETADO', fecha: aprobado, ejecutadoPor: 'WOMPI_WEBHOOK', payload: '{"status":"APPROVED"}' },
    ],
  });

  assert.equal(mensaje.monto, 300000);
  assert.equal(mensaje.idUsuario, 1);
  assert.equal(mensaje.creadoEn, '2026-11-05T14:12:00.000Z');
  assert.equal(mensaje.actualizadoEn, '2026-11-05T14:13:00.000Z');
  assert.equal(mensaje.referenciaExterna, 'WOMPI-2026-0001');
  assert.equal('metodo' in mensaje, false, 'un optional sin valor no viaja');
  assert.equal('_id' in mensaje, false, 'el _id de Mongo no es parte del contrato');
  assert.equal('estadoAnterior' in mensaje.historial[0], false, 'null = acaba de nacer = ausente');
  assert.equal(mensaje.historial[1].estadoAnterior, 'PENDIENTE');
  assert.equal(mensaje.historial[1].payload, '{"status":"APPROVED"}');
  assert.equal(mensaje.historial[1].fecha, '2026-11-05T14:13:00.000Z');
});

test('aDecimal guarda dos decimales exactos y vuelve como number', () => {
  assert.equal(aDecimal(15500.5).toString(), '15500.50');
  assert.equal(aDecimal(300000).toString(), '300000.00');
  assert.equal(transaccionAMensaje({ monto: aDecimal(0.1 + 0.2), historial: [] }).monto, 0.3);
});

test('ida y vuelta: request -> documento -> mensaje conserva lo que llego', () => {
  const datos = validarRegistro(
    { codigo: 'b3a1c0de-0002-4a00-9000-000000000002', idUsuario: 2, tipo: 'apuesta', estado: '', monto: 15500, moneda: '', origen: 'ms-apuestas', ejecutadoPor: 'APUESTA_WEB' },
    creado
  );
  const documento = aDocumentoTransaccion(datos);

  assert.ok(documento.monto instanceof Decimal128);
  assert.equal(documento.monto.toString(), '15500.00');
  assert.ok(documento.idUsuario instanceof Long, 'BIGINT -> long');
  assert.equal(documento.historial.length, 1);
  assert.equal(documento.historial[0].estadoAnterior, null);
  assert.ok('estadoAnterior' in documento.historial[0], 'el null se guarda: significa "acaba de nacer"');
  assert.equal('referenciaExterna' in documento, false, 'una apuesta no trae referencia externa');

  const mensaje = transaccionAMensaje(documento);
  assert.deepEqual(
    { codigo: mensaje.codigo, idUsuario: mensaje.idUsuario, tipo: mensaje.tipo, estado: mensaje.estado, monto: mensaje.monto, moneda: mensaje.moneda },
    { codigo: 'b3a1c0de-0002-4a00-9000-000000000002', idUsuario: 2, tipo: 'APUESTA', estado: 'COMPLETADO', monto: 15500, moneda: 'COP' }
  );
  assert.equal(mensaje.historial[0].ejecutadoPor, 'APUESTA_WEB');
  assert.equal(mensaje.creadoEn, creado.toISOString());
});

test('intento de sesion: idUsuario null se GUARDA (la traza de fuerza bruta), lo opcional se omite', () => {
  const desconocido = aDocumentoIntento({ idUsuario: null, emailIntento: 'noexiste@goldorado.co', ip: '45.132.90.7', exitoso: false, motivoFallo: 'Usuario no encontrado', proveedor: 'LOCAL', fecha: creado });
  assert.ok('idUsuario' in desconocido);
  assert.equal(desconocido.idUsuario, null);
  assert.equal('userAgent' in desconocido, false);
  assert.equal(desconocido.exitoso, false, 'false no es "vacio"');

  const conocido = aDocumentoIntento({ idUsuario: 4, emailIntento: 'a@b.co', ip: '1.1.1.1', exitoso: true, proveedor: 'GOOGLE', fecha: creado });
  assert.ok(conocido.idUsuario instanceof Long);
  assert.equal(aEntero(conocido.idUsuario), 4);
});

test('evento de seguridad: idUsuario opcional se omite y detalle viaja como JSON', () => {
  const documento = aDocumentoEvento({ tipo: 'WEBHOOK_FIRMA_INVALIDA', idUsuario: null, severidad: 'CRITICO', detalle: { ip: '1.2.3.4' }, origen: 'ms-pagos', fecha: creado });
  assert.equal('idUsuario' in documento, false);

  const mensaje = eventoAMensaje({ ...documento, idUsuario: Long.fromNumber(3) });
  assert.equal(mensaje.idUsuario, 3);
  assert.equal(mensaje.detalle, '{"ip":"1.2.3.4"}');
  assert.equal(mensaje.fecha, creado.toISOString());
  assert.equal(eventoAMensaje(documento).idUsuario, undefined);
  assert.equal(eventoAMensaje(documento).ip, undefined);
});

test('aEntero acepta Long, number y null', () => {
  assert.equal(aEntero(Long.fromNumber(7)), 7);
  assert.equal(aEntero(5), 5);
  assert.equal(aEntero(null), null);
  assert.equal(aEntero(undefined), null);
});
