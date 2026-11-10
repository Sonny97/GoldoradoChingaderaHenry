/**
 * Conversiones de los valores que devuelven los drivers al formato de viaje
 * de los contratos gRPC (fechas ISO, numeros).
 *
 * Son las mismas funciones de server/utils/fechas.js del proyecto monolitico,
 * ahora compartidas por los seis servicios.
 */

/** DATE -> 'YYYY-MM-DD', que es lo que espera <input type="date">. */
export function aFechaIso(valor) {
  if (!valor) return null;
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString().slice(0, 10);
}

/** DATETIME / TIMESTAMP -> ISO 8601 completo, que es lo que parsea `new Date()`. */
export function aFechaHoraIso(valor) {
  if (!valor) return null;
  // Timestamp de Firestore
  if (typeof valor?.toDate === 'function') return valor.toDate().toISOString();
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString();
}

/**
 * DECIMAL / NUMERIC / Decimal128 -> number.
 * Los drivers entregan los decimales como cadena (pg, mysql2) o como
 * Decimal128 (mongodb) para no perder precision; aqui se normaliza.
 */
export function aNumero(valor) {
  if (valor === null || valor === undefined) return null;
  const n = Number(typeof valor === 'object' && 'toString' in valor ? valor.toString() : valor);
  return Number.isFinite(n) ? n : null;
}

/** Quita las claves con undefined/null: para no mandar `optional` vacios. */
export function sinVacios(objeto) {
  return Object.fromEntries(
    Object.entries(objeto).filter(([, v]) => v !== undefined && v !== null)
  );
}

/** 250000 -> "$ 250.000" (mensajes de error de limites de monto). */
export function formatearCOP(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(valor);
}
