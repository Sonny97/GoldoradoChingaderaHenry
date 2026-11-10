/**
 * Formateo de presentacion. Nada de logica de negocio aqui.
 */

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

/** 250000 -> "$ 250.000" */
export function formatCurrencyCOP(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$ 0';
  return COP.format(n).replace(/ /g, ' ');
}

/** ISO -> "17 ago" para la hora de inicio de un partido. */
export function formatKickoff(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** ISO -> "17 de agosto de 2026" */
export function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** 67 -> "67'" */
export function formatMinute(minute) {
  if (minute === null || minute === undefined) return '';
  return `${minute}'`;
}

/** "Camilo", "Rojas" -> "CR" */
export function getInitials(name = '', lastname = '') {
  const a = String(name).trim().charAt(0);
  const b = String(lastname).trim().charAt(0);
  return `${a}${b}`.toUpperCase() || '?';
}

/** ISO -> "4 nov 2026, 2:53 p. m." para movimientos y pagos. */
export function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Saldo que puede no existir: null (ms-apuestas no respondio) -> "—". */
export function formatBalance(value) {
  return value === null || value === undefined ? '—' : formatCurrencyCOP(value);
}
