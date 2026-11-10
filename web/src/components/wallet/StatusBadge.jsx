import Badge from '../ui/Badge';

/**
 * Estados de pagos (ms-pagos), apuestas (ms-apuestas) y movimientos
 * (ms-transacciones) en una sola tabla.
 *
 * Cada servicio nombra sus estados a su manera (APROBADO, won, GANADA,
 * completado...). Se normaliza aqui, en un solo lugar, en vez de repetir un
 * switch en cada lista: una variante nueva del backend es una linea en esta
 * tabla y no tres pantallas desalineadas.
 */
const ESTADOS = {
  APROBADO: { variant: 'win', label: 'Aprobado' },
  APPROVED: { variant: 'win', label: 'Aprobado' },
  COMPLETADO: { variant: 'win', label: 'Completado' },
  COMPLETED: { variant: 'win', label: 'Completado' },
  GANADA: { variant: 'win', label: 'Ganada' },
  WON: { variant: 'win', label: 'Ganada' },
  PENDIENTE: { variant: 'info', label: 'Pendiente', dot: true },
  PENDING: { variant: 'info', label: 'Pendiente', dot: true },
  ABIERTA: { variant: 'info', label: 'En juego', dot: true },
  OPEN: { variant: 'info', label: 'En juego', dot: true },
  RECHAZADO: { variant: 'lose', label: 'Rechazado' },
  DECLINED: { variant: 'lose', label: 'Rechazado' },
  PERDIDA: { variant: 'lose', label: 'Perdida' },
  LOST: { variant: 'lose', label: 'Perdida' },
  ERROR: { variant: 'lose', label: 'Error' },
  FALLIDO: { variant: 'lose', label: 'Fallido' },
  FAILED: { variant: 'lose', label: 'Fallido' },
  ANULADO: { variant: 'neutral', label: 'Anulado' },
  ANULADA: { variant: 'neutral', label: 'Anulada' },
  VOIDED: { variant: 'neutral', label: 'Anulado' },
  CANCELADA: { variant: 'neutral', label: 'Cancelada' },
  CANCELLED: { variant: 'neutral', label: 'Cancelada' },
  REEMBOLSADA: { variant: 'gold', label: 'Reembolsada' },
  REFUNDED: { variant: 'gold', label: 'Reembolsada' },
};

function describeStatus(status) {
  const key = String(status ?? '').trim().toUpperCase();
  return ESTADOS[key] ?? { variant: 'neutral', label: status ? String(status) : 'Sin estado' };
}

export default function StatusBadge({ status }) {
  const { variant, label, dot } = describeStatus(status);
  return (
    <Badge variant={variant} dot={dot}>
      {label}
    </Badge>
  );
}
