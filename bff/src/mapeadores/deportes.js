/**
 * Datos de ms-deportes (proto) -> League, Team, Match, jugadores, estadios y
 * calendario de docs/API-REST.md.
 *
 * Las formas son las del monolito (server/repositorios/encuentroRepo.js): el
 * frontend no cambia. Lo unico nuevo es `crestUrl` (escudo en Drive) y que las
 * cuotas lleguen de OTRO servicio; por eso aMatch recibe `odds` y los escudos
 * ya resueltos en vez de buscarlos.
 */

import { aOdd } from './apuestas.js';

const nulo = (v) => (v === undefined ? null : v);

export function aLeague(torneo) {
  if (!torneo) return null;
  return {
    id: torneo.id,
    name: torneo.nombre,
    country: torneo.pais,
    season: torneo.temporada,
    accent: torneo.acento,
  };
}

export function aTeam(equipo, crestUrl = null) {
  if (!equipo) return null;
  return {
    id: equipo.id,
    name: equipo.nombre,
    short: equipo.codigoCorto,
    city: equipo.ciudad,
    leagueId: equipo.idTorneo,
    crestSeed: equipo.crestSeed,
    colors: {
      primary: equipo.colores?.primario ?? null,
      secondary: equipo.colores?.secundario ?? null,
    },
    crestUrl: crestUrl ?? null,
  };
}

/** Team & { league } (catalogo de equipos). */
export function aTeamConLiga(equipo, crestUrl = null) {
  return { ...aTeam(equipo, crestUrl), league: aLeague(equipo.torneo) };
}

/**
 * @param encuentro  Encuentro del proto
 * @param cuotas     Cuota[] de ms-apuestas para ESTE encuentro (ya ordenadas)
 * @param escudos    Map idEquipo(string) -> url
 */
export function aMatch(encuentro, { cuotas = [], escudos = new Map() } = {}) {
  const local = encuentro.local;
  const visitante = encuentro.visitante;
  return {
    id: Number(encuentro.id),
    leagueId: encuentro.idTorneo,
    homeTeamId: local?.id ?? null,
    awayTeamId: visitante?.id ?? null,
    homeScore: nulo(encuentro.golesLocal),
    awayScore: nulo(encuentro.golesVisitante),
    status: encuentro.estado,
    minute: nulo(encuentro.minuto),
    kickoff: encuentro.fechaHora || null,
    stadium: nulo(encuentro.estadio),
    referee: nulo(encuentro.arbitro),
    featured: Boolean(encuentro.destacado),
    homeTeam: aTeam(local, local ? escudos.get(String(local.id)) : null),
    awayTeam: aTeam(visitante, visitante ? escudos.get(String(visitante.id)) : null),
    league: aLeague(encuentro.torneo),
    odds: cuotas.map(aOdd),
  };
}

const par = (p) => [nulo(p?.local), nulo(p?.visitante)];

export function aStats(estadisticas) {
  if (!estadisticas) return null;
  return {
    possession: par(estadisticas.posesion),
    shots: par(estadisticas.tiros),
    shotsOnTarget: par(estadisticas.tirosArco),
    fouls: par(estadisticas.faltas),
    corners: par(estadisticas.corners),
  };
}

export function aLineup(jugador) {
  return {
    id: jugador.id,
    teamId: jugador.idEquipo,
    name: jugador.nombre,
    number: nulo(jugador.dorsal),
    position: jugador.posicion,
    starter: Boolean(jugador.titular),
    goals: Number(jugador.goles ?? 0),
    assists: Number(jugador.asistencias ?? 0),
    minutes: nulo(jugador.minutos),
  };
}

export function aPlayer(jugador) {
  return {
    id: jugador.id,
    teamId: jugador.idEquipo,
    team: jugador.equipo,
    name: jugador.nombres,
    lastname: jugador.apellidos,
    fullName: `${jugador.nombres ?? ''} ${jugador.apellidos ?? ''}`.trim(),
    position: jugador.posicion,
    number: nulo(jugador.dorsal),
    birthDate: jugador.fechaNacimiento || null,
    country: nulo(jugador.paisNacimiento),
    active: Boolean(jugador.activo),
  };
}

export function aStadium(estadio) {
  return {
    id: estadio.id,
    name: estadio.nombre,
    city: estadio.ciudad,
    country: estadio.pais,
    capacity: nulo(estadio.capacidad),
  };
}

/** Jornada del calendario; `matches` ya viene hidratado. */
export function aJornada(jornada, matches) {
  return {
    id: jornada.idJornada,
    number: jornada.numero,
    startDate: jornada.fechaInicio,
    endDate: jornada.fechaFin,
    league: aLeague(jornada.torneo),
    season: jornada.temporada,
    matches,
  };
}
