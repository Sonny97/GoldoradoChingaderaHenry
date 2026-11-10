/**
 * Servicio de promociones. Mismo contrato { success, data, message }.
 *
 * El filtro de vigencia (no mostrar promos vencidas) lo aplica el backend
 * comparando fecha_expira contra la fecha del servidor de base de datos. Antes
 * no se filtraba nada: las seis promos de data/promos.js se mostraban siempre,
 * hubieran vencido o no.
 */

import { http } from './http';

export async function getPromos({ limit, excludeFeatured = false } = {}) {
  return http.get('/promociones', {
    query: { limite: limit, excluirDestacada: excludeFeatured ? 'true' : undefined },
  });
}

/** La promo del banner del boceto: "50% descuento". */
export async function getFeaturedPromo() {
  return http.get('/promociones/destacada');
}

export async function getPromoById(id) {
  return http.get(`/promociones/${id}`);
}
