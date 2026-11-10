/**
 * Servicio de pagos con Wompi. Mismo contrato { success, data, message }.
 *
 * El navegador NUNCA decide si un pago quedo aprobado. La redireccion de vuelta
 * desde el banco es solo informativa: el estado real lo consulta el BFF contra
 * la API de Wompi con la llave privada (o lo recibe por webhook firmado). Por
 * eso aqui no hay ninguna funcion que "marque" un pago.
 */

import { http } from './http';

/** { mode, publicKey, currency, minAmount, maxAmount, methods, suggestedAmounts, termsUrl, personalDataUrl } */
export async function getConfig() {
  return http.get('/pagos/config');
}

export async function getPseBanks() {
  return http.get('/pagos/pse/bancos', { auth: true });
}

/**
 * { amount, bankCode, personType: 0|1, documentType, documentNumber,
 *   acceptTerms, acceptPersonalData }
 *
 * Si la respuesta trae redirectUrl en null, Wompi todavia la esta generando: el
 * caller consulta getPayment(reference) cada 2 s hasta que aparezca.
 */
export async function createPsePayment(values) {
  return http.post('/pagos/pse', values, { auth: true });
}

/** Web Checkout de Wompi (tarjeta, Nequi, Bancolombia...). */
export async function createCheckoutPayment({ amount }) {
  return http.post('/pagos/checkout', { amount }, { auth: true });
}

/** Estado refrescado contra Wompi. Si quedo APROBADO ya viene credited: true. */
export async function getPayment(reference) {
  return http.get(`/pagos/${encodeURIComponent(reference)}`, { auth: true });
}

/** Al volver del checkout Wompi agrega ?id= a la URL de retorno. */
export async function getPaymentByWompiId(id) {
  return http.get(`/pagos/wompi/${encodeURIComponent(id)}`, { auth: true });
}

export async function listPayments({ limit = 20 } = {}) {
  return http.get('/pagos', { query: { limite: limit }, auth: true });
}
