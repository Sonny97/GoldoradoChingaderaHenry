// =============================================================================
//  Esquema: validadores, indices, asegurarEsquema idempotente (sin borrar
//  datos), semilla de CONVENCIONES §5 y coherencia con los scripts mongosh.
//  Los documentos se evaluan contra los $jsonSchema REALES con un evaluador
//  minimo (test/apoyo/falsos.js): sin Mongo, pero sin copiar las reglas.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asegurarEsquema, COLECCIONES, definirColecciones, recrearEsquema, segundosTtl } from '../src/esquema.js';
import { aDocumentoEvento, aDocumentoIntento, aDocumentoTransaccion, aEntero, aEntradaHistorial } from '../src/utils/mapeo.js';
import { validarEvento, validarIntento } from '../src/servicios/seguridad.js';
import { validarRegistro } from '../src/servicios/transacciones.js';
import { CODIGOS_SEMILLA, documentosSemilla, haceDias } from '../db/semilla.js';
import { crearDbFalsa, erroresEsquema } from './apoyo/falsos.js';

const definiciones = Object.fromEntries(definirColecciones({ diasLogsSesion: 180 }).map((d) => [d.nombre, d]));
const esquemaDe = (nombre) => definiciones[nombre].validador.$jsonSchema;
const ahora = new Date('2026-11-09T15:00:00.000Z');
const silencioso = { info() {}, aviso() {}, error() {}, debug() {} };

test('indices con nombre (UQ_/IX_), codigo unico y TTL = LOGS_SESION_DIAS', () => {
  for (const def of Object.values(definiciones)) {
    for (const indice of def.indices) assert.match(indice.nombre, /^(UQ|IX)_/, indice.nombre);
  }
  const uq = definiciones.transacciones.indices.find((i) => i.nombre === 'UQ_Transacciones_Codigo');
  assert.deepEqual(uq.llave, { codigo: 1 });
  assert.equal(uq.opciones.unique, true);

  const ttl = definiciones.logs_sesion.indices.find((i) => i.opciones?.expireAfterSeconds);
  assert.equal(ttl.opciones.expireAfterSeconds, 180 * 86400);
  assert.equal(segundosTtl(30), 30 * 86400);
  assert.equal(segundosTtl(0), 180 * 86400, 'basura = 180 dias');
  assert.equal(segundosTtl(-5), 180 * 86400, 'un negativo no puede dejar el TTL en 1 dia');
  assert.equal(segundosTtl(10 ** 9), 24855 * 86400, 'nunca mas que un entero de 32 bits');
});

test('lo que arma el servicio cabe en los validadores', () => {
  const transaccion = aDocumentoTransaccion(
    validarRegistro({ codigo: 'GD-1', idUsuario: 1, tipo: 'DEPOSITO', estado: 'PENDIENTE', monto: 1000, origen: 'ms-pagos', proveedor: 'Wompi', metodo: 'PSE', payload: '{}' }, ahora)
  );
  transaccion.historial.push(aEntradaHistorial({ estadoAnterior: 'PENDIENTE', estadoNuevo: 'FALLIDO', fecha: ahora, ejecutadoPor: 'WOMPI_WEBHOOK', codigoError: 'DECLINED' }));
  assert.deepEqual(erroresEsquema(transaccion, esquemaDe('transacciones')), []);

  const fallido = aDocumentoIntento(validarIntento({ emailIntento: 'x@y.co', ip: '1.1.1.1', exitoso: false, motivoFallo: 'Usuario no encontrado' }, ahora));
  const exitoso = aDocumentoIntento(validarIntento({ emailIntento: 'x@y.co', idUsuario: 3, ip: '1.1.1.1', exitoso: true, userAgent: 'curl' }, ahora));
  assert.deepEqual(erroresEsquema(fallido, esquemaDe('logs_sesion')), []);
  assert.deepEqual(erroresEsquema(exitoso, esquemaDe('logs_sesion')), []);

  const evento = aDocumentoEvento(validarEvento({ tipo: 'WEBHOOK_FIRMA_INVALIDA', severidad: 'CRITICO', detalle: 'no json', origen: 'ms-pagos' }, ahora));
  assert.deepEqual(erroresEsquema(evento, esquemaDe('eventos_seguridad')), []);
});

test('los validadores rechazan lo que rechazaban las CHECK', () => {
  const valida = documentosSemilla(ahora).transacciones[0];
  const transacciones = esquemaDe('transacciones');
  const logs = esquemaDe('logs_sesion');

  assert.notDeepEqual(erroresEsquema({ ...valida, monto: { _bsontype: 'Decimal128', toString: () => '-5000.00' } }, transacciones), [], 'monto negativo');
  assert.notDeepEqual(erroresEsquema({ ...valida, monto: { _bsontype: 'Decimal128', toString: () => '0.00' } }, transacciones), [], 'monto cero');
  assert.notDeepEqual(erroresEsquema({ ...valida, tipo: 'REGALO' }, transacciones), [], 'CHK_Transaccion_Tipo');
  assert.notDeepEqual(erroresEsquema({ ...valida, monto: 300000 }, transacciones), [], 'dinero en double');
  assert.notDeepEqual(erroresEsquema({ ...valida, historial: [] }, transacciones), [], 'sin historial');
  assert.notDeepEqual(erroresEsquema({ ...valida, extra: 1 }, transacciones), [], 'campo no declarado');

  const fallido = { idUsuario: null, emailIntento: 'x@y.co', ip: '1.1.1.1', exitoso: false, proveedor: 'LOCAL', fecha: ahora };
  assert.notDeepEqual(erroresEsquema(fallido, logs), [], 'CHK_LogSesion_Motivo');
  assert.deepEqual(erroresEsquema({ ...fallido, motivoFallo: 'Usuario no encontrado' }, logs), []);
  const { idUsuario: _omitido, ...sinUsuario } = { ...fallido, motivoFallo: 'x' };
  assert.notDeepEqual(erroresEsquema(sinUsuario, logs), [], 'idUsuario siempre presente (null si no hay)');
  assert.notDeepEqual(erroresEsquema({ ...fallido, motivoFallo: 'x', proveedor: 'FACEBOOK' }, logs), []);
});

test('semilla: CONVENCIONES §5 exacta y valida contra los validadores', () => {
  const semilla = documentosSemilla(ahora);
  assert.deepEqual(semilla.transacciones.map((t) => t.codigo), [...CODIGOS_SEMILLA]);
  assert.ok(semilla.transacciones.length >= 2 && semilla.logsSesion.length >= 2 && semilla.eventosSeguridad.length >= 2);

  const resumen = semilla.transacciones.map((t) => [t.codigo, aEntero(t.idUsuario), t.tipo, t.monto.toString(), t.proveedor ?? null, t.metodo ?? null]);
  assert.deepEqual(resumen, [
    ['GD-SEED-0001', 1, 'DEPOSITO', '300000.00', 'Wompi', 'NEQUI'],
    ['b3a1c0de-0001-4a00-9000-000000000001', 1, 'APUESTA', '50000.00', null, null],
    ['GD-SEED-0002', 2, 'DEPOSITO', '100000.00', 'Wompi', 'PSE'],
    ['b3a1c0de-0002-4a00-9000-000000000002', 2, 'APUESTA', '15500.00', null, null],
  ]);

  // El libro cuadra con cuenta_saldo de ms-apuestas: 250.000 y 84.500 disponibles.
  const saldo = (id) =>
    semilla.transacciones
      .filter((t) => aEntero(t.idUsuario) === id && t.estado === 'COMPLETADO')
      .reduce((s, t) => s + (t.tipo === 'DEPOSITO' ? 1 : -1) * Number(t.monto.toString()), 0);
  assert.equal(saldo(1), 250000);
  assert.equal(saldo(2), 84500);

  const intentos = semilla.logsSesion.map((l) => [l.emailIntento, aEntero(l.idUsuario), l.exitoso, l.proveedor]);
  assert.deepEqual(intentos, [
    ['demo@goldorado.co', 1, true, 'LOCAL'],
    ['valentina.mesa@hotmail.com', 2, false, 'LOCAL'],
    ['noexiste@goldorado.co', null, false, 'LOCAL'],
    ['andres.gomez.demo@gmail.com', 4, true, 'GOOGLE'],
  ]);
  assert.deepEqual(
    semilla.eventosSeguridad.map((e) => [e.tipo, aEntero(e.idUsuario)]),
    [['REGISTRO', 1], ['REGISTRO', 2], ['CUENTA_EXTERNA_VINCULADA', 4]]
  );

  const pares = [
    ...semilla.transacciones.map((d) => [d, 'transacciones']),
    ...semilla.logsSesion.map((d) => [d, 'logs_sesion']),
    ...semilla.eventosSeguridad.map((d) => [d, 'eventos_seguridad']),
  ];
  for (const [documento, coleccion] of pares) {
    assert.deepEqual(erroresEsquema(documento, esquemaDe(coleccion)), [], `${coleccion}: ${JSON.stringify(documento.codigo ?? documento.emailIntento ?? documento.tipo)}`);
    const fechas = [documento.fecha, documento.creadoEn, ...(documento.historial ?? []).map((h) => h.fecha)].filter(Boolean);
    for (const f of fechas) assert.ok(f < ahora, 'la semilla nunca queda en el futuro');
  }
  // Ningun log de la semilla vence con el TTL por defecto.
  const limite = new Date(ahora.getTime() - segundosTtl(180) * 1000);
  assert.ok(semilla.logsSesion.every((l) => l.fecha > limite));
});

test('haceDias: hora de Bogota de N dias atras, aun corriendo cerca de medianoche UTC', () => {
  const casiMedianoche = new Date('2026-11-09T03:30:00.000Z'); // 8/nov 22:30 en Bogota
  assert.equal(haceDias(1, '11:15', casiMedianoche).toISOString(), '2026-11-07T16:15:00.000Z');
  assert.equal(haceDias(2, '20:01', ahora).toISOString(), '2026-11-08T01:01:00.000Z');
});

test('asegurarEsquema en una base vacia crea colecciones con validador e indices', async () => {
  const db = crearDbFalsa();
  await asegurarEsquema(db, { log: silencioso, diasLogsSesion: 180 });

  assert.deepEqual(db.registro.creadas.sort(), Object.values(COLECCIONES).sort());
  assert.equal(db.registro.borradas.length, 0);
  assert.equal(db.registro.indicesCreados.length, 8);
  assert.ok(db.colecciones.get('logs_sesion').validador.$jsonSchema.anyOf);
});

test('asegurarEsquema sobre datos existentes: actualiza sin borrar y es idempotente', async () => {
  const db = crearDbFalsa({
    transacciones: { documentos: 4, indices: [{ name: 'UQ_Transacciones_Codigo', key: { codigo: 1 }, unique: true }] },
    logs_sesion: { documentos: 4, indices: [{ name: 'IX_LogsSesion_Fecha_TTL', key: { fecha: 1 }, expireAfterSeconds: 30 * 86400 }] },
  });
  await asegurarEsquema(db, { log: silencioso, diasLogsSesion: 90 });

  assert.deepEqual(db.registro.creadas, ['eventos_seguridad'], 'solo crea lo que falta');
  assert.equal(db.registro.borradas.length, 0, 'nunca borra');
  assert.equal(db.colecciones.get('transacciones').documentos, 4);
  const collMod = db.registro.comandos.filter((c) => c.collMod && c.validator).map((c) => c.collMod);
  assert.deepEqual(collMod.sort(), ['logs_sesion', 'transacciones'], 'validador al dia en las que ya existian');
  const ttl = db.colecciones.get('logs_sesion').indices.find((i) => i.name === 'IX_LogsSesion_Fecha_TTL');
  assert.equal(ttl.expireAfterSeconds, 90 * 86400, 'el TTL se ajusta en sitio');

  const indicesAntes = db.registro.indicesCreados.length;
  await asegurarEsquema(db, { log: silencioso, diasLogsSesion: 90 });
  assert.equal(db.registro.indicesCreados.length, indicesAntes, 'segunda vez: nada nuevo');
});

test('asegurarEsquema sin permiso de collMod solo avisa', async () => {
  const avisos = [];
  const db = crearDbFalsa({ transacciones: {} }, { sinPermisoCollMod: true });
  await asegurarEsquema(db, { log: { ...silencioso, aviso: (m) => avisos.push(m) }, diasLogsSesion: 180 });
  assert.ok(avisos.some((m) => /collMod/.test(m)));
});

test('recrearEsquema (db:setup) borra y crea de cero, aunque no existan', async () => {
  const db = crearDbFalsa({ transacciones: { documentos: 9 } });
  await recrearEsquema(db, { log: silencioso, diasLogsSesion: 180 });
  assert.deepEqual(db.registro.borradas, ['transacciones']);
  assert.equal(db.registro.creadas.length, 3);
});

test('los scripts mongosh reflejan src/esquema.js y db/semilla.js', () => {
  const colecciones = readFileSync(new URL('../db/01_colecciones.js', import.meta.url), 'utf8');
  const datos = readFileSync(new URL('../db/02_datos.js', import.meta.url), 'utf8');
  const consultas = readFileSync(new URL('../db/03_consultas.js', import.meta.url), 'utf8');

  for (const def of Object.values(definiciones)) {
    assert.ok(colecciones.includes(`createCollection('${def.nombre}'`), def.nombre);
    for (const indice of def.indices) assert.ok(colecciones.includes(`'${indice.nombre}'`), indice.nombre);
  }
  const semilla = documentosSemilla(ahora);
  for (const t of semilla.transacciones) {
    assert.ok(datos.includes(`'${t.codigo}'`), t.codigo);
    assert.ok(datos.includes(`NumberDecimal('${t.monto.toString()}')`), t.monto.toString());
  }
  for (const l of semilla.logsSesion) assert.ok(datos.includes(`'${l.emailIntento}'`), l.emailIntento);
  for (const palabra of ['$addToSet', '$size', '$dateTrunc', '$unwind', '$lookup', '$push', "explain('executionStats')", 'expireAfterSeconds', '$cond']) {
    assert.ok(consultas.includes(palabra), `03_consultas.js deberia usar ${palabra}`);
  }
});
