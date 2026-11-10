/**
 * Servicio de partidos, equipos y ligas.
 *
 * LA HIDRATACION YA NO SE HACE AQUI. Antes este modulo importaba
 * data/matches.js, data/teams.js y data/leagues.js y unia los ids a mano para
 * devolver { ...match, homeTeam, awayTeam, league }.
 *
 * Ahora ese trabajo lo hace la base de datos con JOIN, que es exactamente para
 * lo que sirve, y el backend entrega el partido ya armado. La forma del objeto
 * es la misma, asi que MatchCard sigue siendo un componente tonto que no
 * resuelve un solo id.
 */

import { http } from './http';

export async function getMatches({ status, leagueId, teamId, limit } = {}) {
  return http.get('/encuentros', {
    query: { estado: status, ligaId: leagueId, equipoId: teamId, limite: limit },
  });
}

export async function getFeaturedMatches(limit = 4) {
  return http.get('/encuentros/destacados', { query: { limite: limit } });
}

export async function getMatchById(id) {
  return http.get(`/encuentros/${id}`);
}

export async function getTeams({ leagueId } = {}) {
  return http.get('/catalogos/equipos', { query: { ligaId: leagueId } });
}

export async function getTeamById(id) {
  return http.get(`/catalogos/equipos/${id}`);
}

export async function getLeagues() {
  return http.get('/catalogos/ligas');
}

/**
 * Registra una apuesta de verdad.
 *
 * Antes esto era un stub que validaba el saldo y devolvia un id inventado sin
 * mover un peso. Ahora el backend descuenta el saldo, crea la Transaccion y la
 * Apuesta dentro de una transaccion de base de datos.
 *
 * `oddsId` es el id_cuota que viene en cada chip de la franja de cuotas. Se
 * manda el id y no la seleccion en texto para que el servidor lea el valor
 * vigente de la cuota: si se mandara el valor desde el navegador, cualquiera
 * podria apostar a la cuota que se le antojara.
 */
export async function placeBet({ oddsId, amount }) {
  return http.post('/apuestas', { oddsId, amount }, { auth: true });
}

export async function getMyBets({ limit = 20 } = {}) {
  return http.get('/apuestas', { query: { limite: limit }, auth: true });
}

/** Alimenta el panel "Tu semana" del dashboard. */
export async function getBetSummary() {
  return http.get('/apuestas/resumen', { auth: true });
}
