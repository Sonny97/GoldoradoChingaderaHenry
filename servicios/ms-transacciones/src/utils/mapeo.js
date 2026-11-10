// =============================================================================
//  Conversion documento de Mongo <-> mensaje del .proto.
//
//  Los tipos se eligieron para respetar al monolito:
//   - monto    DECIMAL(18,2) -> Decimal128 (nunca double: el dinero no se
//              redondea en binario). En el contrato viaja como double en pesos.
//   - ids      BIGINT -> long (Long). El driver los devuelve como number.
//   - fechas   DATETIME2 -> Date. En el contrato, string ISO 8601 UTC.
//  Un campo `optional` sin valor se OMITE del mensaje (sinVacios): asi el
//  cliente lo ve como "ausente" y no como ''.
// =============================================================================

import { Decimal128, Long } from 'mongodb';
import { aFechaHoraIso, aNumero, sinVacios } from '@goldorado/comun';

/** 300000 -> Decimal128('300000.00'): dos decimales como el DECIMAL(18,2). */
export const aDecimal = (monto) => Decimal128.fromString(Number(monto).toFixed(2));

/** number -> Long (o null si no hay usuario). */
export const aLong = (id) => (id === null || id === undefined ? null : Long.fromNumber(Number(id)));

/** Long | number -> number (null si no hay). */
export function aEntero(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor.toNumber === 'function') return valor.toNumber();
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------- hacia la base

/** Una entrada del historial (lo que era una fila de Log_Transaccion). */
export function aEntradaHistorial(e) {
  return {
    // Se guarda aunque sea null: null = "la transaccion acaba de nacer".
    estadoAnterior: e.estadoAnterior ?? null,
    ...sinVacios({
      estadoNuevo: e.estadoNuevo,
      fecha: e.fecha,
      ejecutadoPor: e.ejecutadoPor,
      codigoError: e.codigoError,
      payload: e.payload,
    }),
  };
}

/** Documento completo de una transaccion nueva, con su historial de nacimiento. */
export function aDocumentoTransaccion(d) {
  return sinVacios({
    codigo: d.codigo,
    idUsuario: aLong(d.idUsuario),
    tipo: d.tipo,
    estado: d.estado,
    monto: aDecimal(d.monto),
    moneda: d.moneda,
    origen: d.origen,
    referenciaExterna: d.referenciaExterna,
    proveedor: d.proveedor,
    metodo: d.metodo,
    creadoEn: d.fecha,
    actualizadoEn: d.fecha,
    historial: [
      aEntradaHistorial({
        estadoAnterior: null,
        estadoNuevo: d.estado,
        fecha: d.fecha,
        ejecutadoPor: d.ejecutadoPor,
        codigoError: d.codigoError,
        payload: d.payload,
      }),
    ],
  });
}

/** Intento de sesion: idUsuario va SIEMPRE (null si el correo no existe). */
export function aDocumentoIntento(d) {
  return {
    idUsuario: aLong(d.idUsuario),
    ...sinVacios({
      emailIntento: d.emailIntento,
      ip: d.ip,
      userAgent: d.userAgent,
      exitoso: d.exitoso,
      motivoFallo: d.motivoFallo,
      proveedor: d.proveedor,
      fecha: d.fecha,
    }),
  };
}

/** Evento de seguridad: aqui idUsuario es opcional de verdad (se omite). */
export function aDocumentoEvento(d) {
  return sinVacios({
    tipo: d.tipo,
    idUsuario: aLong(d.idUsuario),
    ip: d.ip,
    severidad: d.severidad,
    detalle: d.detalle,
    origen: d.origen,
    fecha: d.fecha,
  });
}

// ------------------------------------------------------------ hacia el proto

export function cambioAMensaje(c) {
  return sinVacios({
    estadoAnterior: c.estadoAnterior, // null -> ausente: acaba de nacer
    estadoNuevo: c.estadoNuevo,
    fecha: aFechaHoraIso(c.fecha),
    ejecutadoPor: c.ejecutadoPor,
    codigoError: c.codigoError,
    payload: c.payload,
  });
}

export function transaccionAMensaje(doc) {
  return sinVacios({
    codigo: doc.codigo,
    idUsuario: aEntero(doc.idUsuario),
    tipo: doc.tipo,
    estado: doc.estado,
    monto: aNumero(doc.monto),
    moneda: doc.moneda,
    origen: doc.origen,
    referenciaExterna: doc.referenciaExterna,
    proveedor: doc.proveedor,
    metodo: doc.metodo,
    creadoEn: aFechaHoraIso(doc.creadoEn),
    actualizadoEn: aFechaHoraIso(doc.actualizadoEn),
    historial: (doc.historial ?? []).map(cambioAMensaje),
  });
}

export function eventoAMensaje(doc) {
  return sinVacios({
    tipo: doc.tipo,
    idUsuario: aEntero(doc.idUsuario),
    ip: doc.ip,
    severidad: doc.severidad,
    detalle: JSON.stringify(doc.detalle ?? {}),
    fecha: aFechaHoraIso(doc.fecha),
    origen: doc.origen,
  });
}
