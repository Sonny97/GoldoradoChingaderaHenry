/**
 * Datos de ms-pagos (proto) -> Payment, configuracion y bancos PSE.
 *
 * `redirectUrl` puede ser null un rato: con PSE, Wompi genera la URL del banco
 * de forma asincrona y el frontend consulta GET /api/pagos/:referencia hasta
 * que llega (ver docs/WOMPI.md).
 */

const nulo = (v) => (v === undefined || v === '' ? null : v);

export function aPayment(pago) {
  return {
    reference: pago.referencia,
    amount: Number(pago.monto),
    currency: pago.moneda || 'COP',
    method: pago.metodo,
    status: pago.estado,
    statusMessage: nulo(pago.mensajeEstado),
    wompiTransactionId: nulo(pago.idTransaccionWompi),
    redirectUrl: nulo(pago.urlPago),
    credited: Boolean(pago.acreditado),
    bank: nulo(pago.banco),
    paymentMethodType: nulo(pago.medioWompi),
    createdAt: pago.creadoEn || null,
    updatedAt: pago.actualizadoEn || null,
  };
}

export function aConfigPagos(c) {
  return {
    mode: c.modo,
    publicKey: c.llavePublica ?? '',
    currency: c.moneda || 'COP',
    minAmount: Number(c.montoMinimo),
    maxAmount: Number(c.montoMaximo),
    methods: [...(c.metodos ?? [])],
    suggestedAmounts: (c.montosSugeridos ?? []).map(Number),
    termsUrl: c.urlReglamento ?? '',
    personalDataUrl: c.urlDatosPersonales ?? '',
  };
}

export const aBanco = (b) => ({ code: b.codigo, name: b.nombre });
