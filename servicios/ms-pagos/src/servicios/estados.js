/**
 * Estados de un pago y sus equivalencias (funciones puras).
 *
 * Tres vocabularios distintos conviven y se traducen SOLO aqui:
 * - Wompi (PENDING, APPROVED, DECLINED, VOIDED, ERROR).
 * - El pago en Firestore (PENDIENTE, APROBADO, RECHAZADO, ANULADO, ERROR).
 * - El libro de movimientos de ms-transacciones (PENDIENTE, COMPLETADO,
 *   FALLIDO, REVERSADO).
 */

export const ESTADOS = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  APROBADO: 'APROBADO',
  RECHAZADO: 'RECHAZADO',
  ANULADO: 'ANULADO',
  ERROR: 'ERROR',
});

export const METODOS = Object.freeze(['PSE', 'CHECKOUT']);

const DESDE_WOMPI = Object.freeze({
  PENDING: ESTADOS.PENDIENTE,
  APPROVED: ESTADOS.APROBADO,
  DECLINED: ESTADOS.RECHAZADO,
  VOIDED: ESTADOS.ANULADO,
  ERROR: ESTADOS.ERROR,
});

const HACIA_LIBRO = Object.freeze({
  PENDIENTE: 'PENDIENTE',
  APROBADO: 'COMPLETADO',
  RECHAZADO: 'FALLIDO',
  ERROR: 'FALLIDO',
  ANULADO: 'REVERSADO',
});

/**
 * Estado de Wompi -> estado del pago. Un estado desconocido (Wompi puede
 * agregar uno nuevo) se trata como PENDIENTE: nunca acredita por accidente y la
 * conciliacion lo vuelve a consultar.
 */
export function estadoDesdeWompi(estadoWompi) {
  return DESDE_WOMPI[String(estadoWompi ?? '').toUpperCase()] ?? ESTADOS.PENDIENTE;
}

/** Estado del pago -> estado del movimiento en el libro (MongoDB). */
export function estadoLibro(estado) {
  return HACIA_LIBRO[estado] ?? 'PENDIENTE';
}

export const esFinal = (estado) => estado !== ESTADOS.PENDIENTE;

/**
 * La transaccion de Wompi corresponde a NUESTRO registro: misma referencia,
 * mismos centavos (comparacion estricta, sin redondeos) y moneda COP.
 * Devuelve la lista de diferencias (vacia = coincide).
 */
export function diferenciasConWompi(pago, tx) {
  const diferencias = [];
  if (tx?.reference !== pago.referencia) diferencias.push('referencia');
  if (tx?.amount_in_cents !== pago.montoCentavos) diferencias.push('monto');
  if (tx?.currency !== 'COP') diferencias.push('moneda');
  return diferencias;
}
