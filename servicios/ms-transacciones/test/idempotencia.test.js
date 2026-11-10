// =============================================================================
//  Idempotencia por `codigo` (CONVENCIONES §4: un reintento nunca duplica
//  dinero) y cambios de estado con historial. Servicio + repositorio REALES
//  sobre una coleccion falsa en memoria: se prueba la decision completa sin
//  base de datos.
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { Long } from 'mongodb';
import { crearRepositorioTransacciones } from '../src/repositorios/transacciones.js';
import { crearServicioSeguridad } from '../src/servicios/seguridad.js';
import { crearServicioTransacciones, decidirRegistro, NO_ENCONTRADA } from '../src/servicios/transacciones.js';
import { aDecimal } from '../src/utils/mapeo.js';
import { crearColeccionFalsa } from './apoyo/falsos.js';

const T0 = new Date('2026-11-09T14:00:00.000Z');
const T1 = new Date('2026-11-09T14:05:00.000Z');

function preparar({ reloj = () => T0, envolver = (r) => r } = {}) {
  const coleccion = crearColeccionFalsa();
  const repo = envolver(crearRepositorioTransacciones(() => coleccion));
  return { coleccion, servicio: crearServicioTransacciones({ repo, reloj }) };
}

const deposito = {
  codigo: 'GD-SEED-0001',
  idUsuario: 1,
  tipo: 'DEPOSITO',
  estado: 'PENDIENTE',
  monto: 300000,
  origen: 'ms-pagos',
  proveedor: 'Wompi',
  metodo: 'NEQUI',
  ejecutadoPor: 'SISTEMA',
};

test('el primer registro inserta con su historial de nacimiento', async () => {
  const { coleccion, servicio } = preparar();
  const doc = await servicio.registrar(deposito);

  assert.equal(coleccion.documentos.length, 1);
  assert.equal(doc.codigo, 'GD-SEED-0001');
  assert.equal(doc.monto.toString(), '300000.00');
  assert.deepEqual(doc.historial, [{ estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: T0, ejecutadoPor: 'SISTEMA' }]);
});

test('un reintento exacto NO duplica ni escribe: devuelve la existente', async () => {
  const { coleccion, servicio } = preparar();
  await servicio.registrar(deposito);
  const escriturasAntes = coleccion.escrituras;

  const doc = await servicio.registrar(deposito);
  await servicio.registrar(deposito);

  assert.equal(coleccion.documentos.length, 1);
  assert.equal(coleccion.escrituras, escriturasAntes, 'mismo estado: ni una escritura');
  assert.equal(doc.historial.length, 1);
});

test('mismo codigo con OTRO estado: se agrega al historial (PENDIENTE -> COMPLETADO)', async () => {
  let ahora = T0;
  const { coleccion, servicio } = preparar({ reloj: () => ahora });
  await servicio.registrar(deposito);

  ahora = T1;
  const doc = await servicio.registrar({ ...deposito, estado: 'COMPLETADO', ejecutadoPor: 'WOMPI_WEBHOOK', payload: '{"status":"APPROVED"}' });

  assert.equal(coleccion.documentos.length, 1);
  assert.equal(doc.estado, 'COMPLETADO');
  assert.equal(doc.actualizadoEn, T1);
  assert.equal(doc.creadoEn, T0, 'la fecha de creacion no se toca');
  assert.deepEqual(doc.historial[1], {
    estadoAnterior: 'PENDIENTE',
    estadoNuevo: 'COMPLETADO',
    fecha: T1,
    ejecutadoPor: 'WOMPI_WEBHOOK',
    payload: '{"status":"APPROVED"}',
  });
});

test('mismo codigo con otro monto, tipo o usuario: FAILED_PRECONDITION, no se esconde', async () => {
  const { coleccion, servicio } = preparar();
  await servicio.registrar(deposito);

  await assert.rejects(servicio.registrar({ ...deposito, monto: 299000 }), (error) => {
    assert.equal(error.codigo, CODIGOS.FAILED_PRECONDITION);
    assert.match(error.message, /otros datos/);
    assert.deepEqual(error.datos.distintos, ['monto']);
    return true;
  });
  await assert.rejects(servicio.registrar({ ...deposito, tipo: 'PREMIO' }), (e) => e.codigo === CODIGOS.FAILED_PRECONDITION);
  assert.equal(coleccion.documentos[0].historial.length, 1);
});

test('un registro posterior completa datos que faltaban (id de Wompi) sin tocar el historial', async () => {
  const { servicio } = preparar();
  await servicio.registrar({ ...deposito, estado: 'COMPLETADO' });
  const doc = await servicio.registrar({ ...deposito, estado: 'COMPLETADO', referenciaExterna: 'WOMPI-2026-0001' });

  assert.equal(doc.referenciaExterna, 'WOMPI-2026-0001');
  assert.equal(doc.historial.length, 1);
});

test('ActualizarEstado: NOT_FOUND, no-op con el mismo estado y $push con el nuevo', async () => {
  let ahora = T0;
  const { coleccion, servicio } = preparar({ reloj: () => ahora });

  await assert.rejects(
    servicio.actualizarEstado({ codigo: 'NO-EXISTE', estadoNuevo: 'FALLIDO' }),
    (e) => e.codigo === CODIGOS.NOT_FOUND && e.message === NO_ENCONTRADA
  );

  await servicio.registrar(deposito);
  const escrituras = coleccion.escrituras;
  await servicio.actualizarEstado({ codigo: deposito.codigo, estadoNuevo: 'PENDIENTE', ejecutadoPor: 'X' });
  assert.equal(coleccion.escrituras, escrituras, 'mismo estado: no ensucia el historial');

  ahora = T1;
  const doc = await servicio.actualizarEstado({ codigo: deposito.codigo, estadoNuevo: 'FALLIDO', ejecutadoPor: 'WOMPI_WEBHOOK', codigoError: 'DECLINED' });
  assert.equal(doc.estado, 'FALLIDO');
  assert.deepEqual(doc.historial.at(-1), { estadoAnterior: 'PENDIENTE', estadoNuevo: 'FALLIDO', fecha: T1, ejecutadoPor: 'WOMPI_WEBHOOK', codigoError: 'DECLINED' });
});

test('ObtenerTransaccion: NOT_FOUND con el mensaje del contrato', async () => {
  const { servicio } = preparar();
  await assert.rejects(servicio.obtener({ codigo: 'b3a1c0de-9999' }), (e) => e.codigo === CODIGOS.NOT_FOUND && e.message === 'Transacción no encontrada');
});

test('si otro proceso cambia el estado en el medio, se relee y se vuelve a decidir', async () => {
  let llamadas = 0;
  const { servicio } = preparar({
    envolver: (repo) => ({
      ...repo,
      aplicarCambio: async (args) => {
        llamadas += 1;
        return llamadas === 1 ? null : repo.aplicarCambio(args); // la primera "pierde la carrera"
      },
    }),
  });
  await servicio.registrar(deposito);
  const doc = await servicio.actualizarEstado({ codigo: deposito.codigo, estadoNuevo: 'COMPLETADO' });
  assert.equal(llamadas, 2);
  assert.equal(doc.estado, 'COMPLETADO');
  assert.equal(doc.historial.length, 2);
});

test('si la carrera no termina, FAILED_PRECONDITION (nunca un historial mentiroso)', async () => {
  const { servicio } = preparar({ envolver: (repo) => ({ ...repo, aplicarCambio: async () => null }) });
  await servicio.registrar(deposito);
  await assert.rejects(servicio.actualizarEstado({ codigo: deposito.codigo, estadoNuevo: 'COMPLETADO' }), (e) => e.codigo === CODIGOS.FAILED_PRECONDITION);
});

test('carrera en la insercion (E11000): se devuelve la que gano', async () => {
  const existente = { codigo: 'GD-SEED-0002', idUsuario: Long.fromNumber(2), tipo: 'DEPOSITO', estado: 'COMPLETADO', monto: aDecimal(100000), historial: [] };
  const coleccion = {
    findOneAndUpdate: async () => {
      throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    },
    findOne: async () => existente,
  };
  const repo = crearRepositorioTransacciones(() => coleccion);
  const resultado = await repo.insertarSiNoExiste({ ...deposito, codigo: 'GD-SEED-0002', idUsuario: 2, estado: 'COMPLETADO', monto: 100000, fecha: T0 });
  assert.deepEqual(resultado, { documento: existente, creada: false });
});

test('decidirRegistro: decision pura (Long y Decimal128 contra number)', () => {
  const existente = { idUsuario: Long.fromNumber(1), tipo: 'DEPOSITO', estado: 'PENDIENTE', monto: aDecimal(300000), proveedor: 'Wompi' };
  const datos = { idUsuario: 1, tipo: 'DEPOSITO', estado: 'PENDIENTE', monto: 300000, proveedor: 'Wompi' };

  assert.deepEqual(decidirRegistro(existente, datos), { accion: 'igual' });
  assert.deepEqual(decidirRegistro(existente, { ...datos, estado: 'COMPLETADO' }), { accion: 'cambiar-estado', completar: {} });
  assert.deepEqual(decidirRegistro(existente, { ...datos, metodo: 'NEQUI' }), { accion: 'completar', completar: { metodo: 'NEQUI' } });
  assert.deepEqual(decidirRegistro(existente, { ...datos, proveedor: 'Otro' }), { accion: 'igual' }, 'lo que ya estaba no se reescribe');
  assert.deepEqual(decidirRegistro(existente, { ...datos, idUsuario: 2, monto: 1 }), { accion: 'conflicto', distintos: ['idUsuario', 'monto'] });
});

test('el error de conflicto lleva sus datos (viajan en x-datos hasta el BFF)', async () => {
  const { servicio } = preparar();
  await servicio.registrar(deposito);
  const error = await servicio.registrar({ ...deposito, idUsuario: 9 }).catch((e) => e);
  assert.deepEqual(error.datos, { codigo: 'GD-SEED-0001', distintos: ['idUsuario'] });
});

test('seguridad: el servicio normaliza antes de llegar al repositorio', async () => {
  const llamadas = [];
  const repo = {
    insertarIntento: async (d) => llamadas.push(['intento', d]),
    contarFallidos: async (d) => (llamadas.push(['contar', d]), 3),
    insertarEvento: async (d) => llamadas.push(['evento', d]),
    listarEventos: async (d) => (llamadas.push(['listar', d]), []),
  };
  const servicio = crearServicioSeguridad({ repo, reloj: () => T1 });

  await servicio.registrarIntento({ emailIntento: 'NoExiste@GolDorado.co', ip: '45.132.90.7', exitoso: false, motivoFallo: 'Usuario no encontrado', proveedor: '' });
  assert.equal(await servicio.contarFallidos({ emailIntento: 'noexiste@goldorado.co', ventanaMinutos: 0 }), 3);
  await servicio.registrarEvento({ tipo: 'REGISTRO', idUsuario: 1, severidad: 'INFO', detalle: '{"email":"demo@goldorado.co"}', origen: 'ms-autenticacion' });
  await servicio.listarEventos({ limite: 0 });

  const [[, intento], [, conteo], [, evento], [, listado]] = llamadas;
  assert.equal(intento.idUsuario, null);
  assert.equal(intento.emailIntento, 'noexiste@goldorado.co');
  assert.equal(intento.fecha, T1);
  assert.equal(conteo.desde.toISOString(), '2026-11-09T13:50:00.000Z', 'ventana de 15 minutos');
  assert.deepEqual(evento.detalle, { email: 'demo@goldorado.co' });
  assert.equal(listado.limite, 50);
});
