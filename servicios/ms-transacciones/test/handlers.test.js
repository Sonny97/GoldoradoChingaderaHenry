// =============================================================================
//  Handlers gRPC: estan TODOS los RPC del .proto (si falta uno el servidor no
//  arranca) y traducen documento -> mensaje sin decidir nada.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Decimal128, Long } from 'mongodb';
import { crearHandlers } from '../src/grpc/handlers.js';

const proto = readFileSync(new URL('../../../proto/transacciones.proto', import.meta.url), 'utf8');
const rpcsDelProto = [...proto.matchAll(/^\s*rpc\s+(\w+)/gm)].map((m) => m[1]);

const fecha = new Date('2026-11-08T01:05:00.000Z');
const documento = {
  codigo: 'b3a1c0de-0001-4a00-9000-000000000001',
  idUsuario: Long.fromNumber(1),
  tipo: 'APUESTA',
  estado: 'COMPLETADO',
  monto: Decimal128.fromString('50000.00'),
  moneda: 'COP',
  origen: 'ms-apuestas',
  creadoEn: fecha,
  actualizadoEn: fecha,
  historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha, ejecutadoPor: 'APUESTA_WEB' }],
};

function handlersFalsos() {
  const recibido = {};
  const transacciones = {
    registrar: async (req) => ((recibido.registrar = req), documento),
    actualizarEstado: async () => documento,
    listar: async (req) => ((recibido.listar = req), [documento, documento]),
    obtener: async () => documento,
  };
  const seguridad = {
    registrarIntento: async (req) => (recibido.intento = req),
    contarFallidos: async () => 4,
    registrarEvento: async () => undefined,
    listarEventos: async () => [{ tipo: 'REGISTRO', idUsuario: Long.fromNumber(2), severidad: 'INFO', detalle: { a: 1 }, origen: 'ms-autenticacion', fecha }],
  };
  const salud = async () => ({ servicio: 'ms-transacciones', estado: 'ok' });
  return { recibido, handlers: crearHandlers({ transacciones, seguridad, salud }) };
}

test('implementa exactamente los RPC de transacciones.proto', () => {
  const { handlers } = handlersFalsos();
  assert.equal(rpcsDelProto.length, 9);
  assert.deepEqual(Object.keys(handlers).sort(), [...rpcsDelProto].sort());
});

test('traduce documentos a mensajes del contrato', async () => {
  const { handlers, recibido } = handlersFalsos();

  const transaccion = await handlers.RegistrarTransaccion({ codigo: 'x' });
  assert.equal(recibido.registrar.codigo, 'x', 'el request llega intacto al servicio');
  assert.equal(transaccion.monto, 50000);
  assert.equal(transaccion.idUsuario, 1);
  assert.equal(transaccion.creadoEn, '2026-11-08T01:05:00.000Z');

  const lista = await handlers.ListarTransacciones({ idUsuario: 1 });
  assert.equal(lista.transacciones.length, 2);

  assert.deepEqual(await handlers.RegistrarIntentoSesion({}), {});
  assert.deepEqual(await handlers.RegistrarEventoSeguridad({}), {});
  assert.deepEqual(await handlers.ContarIntentosFallidos({}), { fallidos: 4 });

  const { eventos } = await handlers.ListarEventosSeguridad({});
  assert.deepEqual(eventos[0], {
    tipo: 'REGISTRO',
    idUsuario: 2,
    severidad: 'INFO',
    detalle: '{"a":1}',
    fecha: '2026-11-08T01:05:00.000Z',
    origen: 'ms-autenticacion',
  });
  assert.equal((await handlers.Salud({})).servicio, 'ms-transacciones');
});
