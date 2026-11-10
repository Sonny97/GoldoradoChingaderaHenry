/**
 * Transaccion del libro de ms-transacciones (MongoDB) -> movimiento de la
 * billetera. El historial embebido de cambios de estado no se manda: la
 * pantalla de movimientos no lo usa y es lo mas pesado del documento.
 */

const nulo = (v) => (v === undefined || v === '' ? null : v);

export function aMovement(t) {
  return {
    code: t.codigo,
    type: t.tipo,
    status: t.estado,
    amount: Number(t.monto),
    currency: t.moneda || 'COP',
    origin: t.origen,
    reference: nulo(t.referenciaExterna),
    provider: nulo(t.proveedor),
    method: nulo(t.metodo),
    createdAt: t.creadoEn || null,
    updatedAt: t.actualizadoEn || null,
  };
}
