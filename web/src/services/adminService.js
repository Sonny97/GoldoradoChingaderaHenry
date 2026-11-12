/**
 * Servicio del panel de administracion (/api/admin, solo rol admin).
 *
 * El admin mueve el partido en ms-deportes; si lo deja finalizado o cancelado,
 * el BFF liquida las apuestas en ms-apuestas y devuelve el Settlement:
 * { matchId, matchStatus, settled, won, lost, voided, paidOut }.
 */

import { http } from './http';

/** Todos los partidos (todos los estados), ya hidratados como en /encuentros. */
export async function getAdminMatches() {
  return http.get('/admin/encuentros', { auth: true });
}

/** -> { match, settlement | null }. settlement null con partido terminado = reintentar. */
export async function updateMatch(id, { status, minute, homeScore, awayScore }) {
  return http.patch(`/admin/encuentros/${id}`, { status, minute, homeScore, awayScore }, { auth: true });
}

/** Reintento manual de la liquidacion. Idempotente: no paga dos veces. */
export async function settleMatch(id) {
  return http.post(`/admin/encuentros/${id}/liquidar`, {}, { auth: true });
}
