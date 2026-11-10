// =============================================================================
//  Validacion de requests: lo que el monolito prohibia con CHECK se rechaza
//  aqui primero con INVALID_ARGUMENT y un mensaje en espanol; los DEFAULT de
//  las columnas se vuelven valores por defecto.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { validarActualizacion, validarListado, validarMonto, validarRegistro } from '../src/servicios/transacciones.js';
import {
  interpretarDetalle,
  validarConteo,
  validarEvento,
  validarIntento,
  validarListadoEventos,
} from '../src/servicios/seguridad.js';

const ahora = new Date('2026-11-09T15:00:00.000Z');
const invalido = (patron) => (error) => error.codigo === CODIGOS.INVALID_ARGUMENT && patron.test(error.message);

const base = {
  codigo: 'GD-SEED-0001',
  idUsuario: 1,
  tipo: 'DEPOSITO',
  estado: 'PENDIENTE',
  monto: 300000,
  moneda: 'COP',
  origen: 'ms-pagos',
  ejecutadoPor: 'SISTEMA',
};

test('RegistrarTransaccion: codigo, usuario, tipo y estado obligatorios y validos', () => {
  assert.throws(() => validarRegistro({ ...base, codigo: '  ' }, ahora), invalido(/código/));
  assert.throws(() => validarRegistro({ ...base, codigo: 'x'.repeat(151) }, ahora), invalido(/código/));
  assert.throws(() => validarRegistro({ ...base, idUsuario: 0 }, ahora), invalido(/usuario/));
  assert.throws(() => validarRegistro({ ...base, tipo: 'REGALO' }, ahora), invalido(/Tipo de transacción/));
  assert.throws(() => validarRegistro({ ...base, tipo: '' }, ahora), invalido(/Tipo de transacción/));
  assert.throws(() => validarRegistro({ ...base, estado: 'APROBADO' }, ahora), invalido(/Estado de transacción/));
  assert.throws(() => validarRegistro({ ...base, fecha: 'ayer' }, ahora), invalido(/Fecha/));
  assert.throws(() => validarRegistro({ ...base, moneda: 'pesos' }, ahora), invalido(/Moneda/));
});

test('monto > 0 (CHK_Transaccion_Monto) y redondeado a 2 decimales', () => {
  for (const malo of [0, -1, Number.NaN, 0.001, 1e16, undefined]) {
    assert.throws(() => validarMonto(malo), invalido(/monto/), `debia rechazar ${malo}`);
  }
  assert.equal(validarMonto(15500.555), 15500.56);
  assert.equal(validarMonto(0.01), 0.01);
});

test('RegistrarTransaccion: los DEFAULT del monolito y la normalizacion', () => {
  const datos = validarRegistro({ ...base, tipo: ' deposito ', estado: '', moneda: '', origen: '', ejecutadoPor: '', referenciaExterna: '', fecha: undefined }, ahora);
  assert.equal(datos.tipo, 'DEPOSITO');
  assert.equal(datos.estado, 'COMPLETADO', 'DF_Transaccion_Estado');
  assert.equal(datos.moneda, 'COP');
  assert.equal(datos.ejecutadoPor, 'SISTEMA', 'DF_LogTransaccion_Por');
  assert.equal(datos.origen, 'desconocido');
  assert.equal(datos.referenciaExterna, undefined, "'' en un optional = no vino");
  assert.equal(datos.fecha, ahora, 'fecha ausente = ahora');
  assert.equal(validarRegistro({ ...base, fecha: '2026-11-01T10:00:00Z' }, ahora).fecha.toISOString(), '2026-11-01T10:00:00.000Z');
});

test('ActualizarEstado y listados', () => {
  assert.throws(() => validarActualizacion({ codigo: 'X', estadoNuevo: 'CANCELADO' }), invalido(/Estado/));
  const datos = validarActualizacion({ codigo: 'X', estadoNuevo: 'fallido', ejecutadoPor: '', codigoError: 'E'.repeat(80) });
  assert.equal(datos.estadoNuevo, 'FALLIDO');
  assert.equal(datos.ejecutadoPor, 'SISTEMA');
  assert.equal(datos.codigoError.length, 50, 'auditoria: se recorta, no se pierde');

  assert.equal(validarListado({ idUsuario: 1, limite: 0 }).limite, 20);
  assert.equal(validarListado({ idUsuario: 1, limite: 500 }).limite, 100);
  assert.equal(validarListado({ idUsuario: 1, limite: 7, tipo: undefined }).tipo, undefined);
  assert.equal(validarListado({ idUsuario: 1, tipo: 'premio' }).tipo, 'PREMIO');
  assert.throws(() => validarListado({ idUsuario: 1, tipo: 'BONO' }), invalido(/Tipo/));
  assert.throws(() => validarListado({ idUsuario: 0 }), invalido(/usuario/));
});

test('RegistrarIntentoSesion: un intento fallido SIEMPRE dice por que (CHK_LogSesion_Motivo)', () => {
  const intento = { emailIntento: 'Demo@GolDorado.co ', ip: '127.0.0.1', exitoso: false, proveedor: 'LOCAL' };
  assert.throws(() => validarIntento(intento, ahora), invalido(/por qué falló/));
  assert.throws(() => validarIntento({ ...intento, motivoFallo: '   ' }, ahora), invalido(/por qué falló/));
  assert.throws(() => validarIntento({ ...intento, emailIntento: '' , motivoFallo: 'x' }, ahora), invalido(/correo/));
  assert.throws(() => validarIntento({ ...intento, motivoFallo: 'x', proveedor: 'FACEBOOK' }, ahora), invalido(/Proveedor/));

  const datos = validarIntento({ ...intento, motivoFallo: 'Contraseña incorrecta', userAgent: 'u'.repeat(400), proveedor: '', ip: '' }, ahora);
  assert.equal(datos.emailIntento, 'demo@goldorado.co', 'mismo objetivo sin importar mayusculas');
  assert.equal(datos.idUsuario, null, 'correo inexistente: null a proposito');
  assert.equal(datos.proveedor, 'LOCAL');
  assert.equal(datos.ip, 'desconocida');
  assert.equal(datos.userAgent.length, 255);
  assert.equal(datos.fecha, ahora);

  const exitoso = validarIntento({ emailIntento: 'andres.gomez.demo@gmail.com', idUsuario: 4, ip: '1.1.1.1', exitoso: true, proveedor: 'google' }, ahora);
  assert.equal(exitoso.idUsuario, 4);
  assert.equal(exitoso.proveedor, 'GOOGLE');
  assert.equal(exitoso.motivoFallo, undefined);
});

test('ContarIntentosFallidos: ventana por defecto 15 minutos, maximo un dia', () => {
  assert.equal(validarConteo({ emailIntento: 'a@b.co', ventanaMinutos: 0 }).ventanaMinutos, 15);
  assert.equal(validarConteo({ emailIntento: 'a@b.co', ventanaMinutos: 100000 }).ventanaMinutos, 1440);
  assert.equal(validarConteo({ emailIntento: ' A@B.CO', ventanaMinutos: 5 }).emailIntento, 'a@b.co');
  assert.throws(() => validarConteo({ emailIntento: '' }), invalido(/correo/));
});

test('detalle JSON -> objeto; lo que no es objeto JSON se guarda envuelto', () => {
  assert.deepEqual(interpretarDetalle('{"proveedor":"GOOGLE"}'), { proveedor: 'GOOGLE' });
  assert.deepEqual(interpretarDetalle('esto no es json'), { texto: 'esto no es json' });
  assert.deepEqual(interpretarDetalle('[1,2]'), { valor: [1, 2] });
  assert.deepEqual(interpretarDetalle('42'), { valor: 42 });
  assert.deepEqual(interpretarDetalle(undefined), {});
});

test('RegistrarEventoSeguridad y ListarEventos', () => {
  const evento = validarEvento({ tipo: 'cierre_sesion', severidad: '', origen: '', idUsuario: 0 }, ahora);
  assert.equal(evento.tipo, 'CIERRE_SESION');
  assert.equal(evento.severidad, 'INFO');
  assert.equal(evento.origen, 'desconocido');
  assert.equal(evento.idUsuario, null);
  assert.deepEqual(evento.detalle, {});
  assert.throws(() => validarEvento({ tipo: '' }, ahora), invalido(/tipo del evento/));
  assert.throws(() => validarEvento({ tipo: 'cierre de sesion' }, ahora), invalido(/Tipo de evento/));
  assert.throws(() => validarEvento({ tipo: 'REGISTRO', severidad: 'GRAVE' }, ahora), invalido(/Severidad/));

  assert.equal(validarListadoEventos({ limite: 0 }).limite, 50);
  assert.equal(validarListadoEventos({ limite: 1000 }).limite, 200);
  assert.equal(validarListadoEventos({ tipo: 'registro', idUsuario: 2 }).tipo, 'REGISTRO');
});
