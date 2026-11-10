/**
 * ARCHIVO DE REFERENCIA - YA NO SE IMPORTA EN NINGUNA PARTE.
 *
 * Estos datos ahora viven en SQL Server (tablas Equipo, Equipo_Color y Ciudad)
 * y llegan por el API. Se conserva porque es la fuente de la que se escribio
 * server/db/02_datos.sql y permite comparar una cosa con la otra.
 * Editarlo NO cambia nada en la aplicacion: hay que editar el seed.
 *
 * ---------------------------------------------------------------------------
 * Equipos. 4 por liga = 16, suficiente para 8 partidos simultaneos sin que
 * ningun equipo aparezca dos veces en la misma jornada.
 *
 * `short` son EXACTAMENTE 3 caracteres: es lo que dibuja <TeamCrest>.
 * `crestSeed` (0|1|2) elige el patron de la banda decorativa.
 */

export const TEAMS = [
  // ---- Liga BetPlay
  { id: 't-01', name: 'Millonarios',     short: 'MIL', city: 'Bogotá',      leagueId: 'l-01', colors: { primary: '#123a8f', secondary: '#ffffff' }, crestSeed: 0 },
  { id: 't-02', name: 'Atlético Nacional', short: 'NAL', city: 'Medellín',  leagueId: 'l-01', colors: { primary: '#0f8a3c', secondary: '#f7e9b8' }, crestSeed: 1 },
  { id: 't-03', name: 'América de Cali', short: 'AME', city: 'Cali',        leagueId: 'l-01', colors: { primary: '#c8102e', secondary: '#ffffff' }, crestSeed: 2 },
  { id: 't-04', name: 'Junior',          short: 'JUN', city: 'Barranquilla', leagueId: 'l-01', colors: { primary: '#e8d21c', secondary: '#c8102e' }, crestSeed: 0 },

  // ---- Copa Libertadores
  { id: 't-05', name: 'Boca Juniors',    short: 'BOC', city: 'Buenos Aires', leagueId: 'l-02', colors: { primary: '#0b3a86', secondary: '#f2c50a' }, crestSeed: 1 },
  { id: 't-06', name: 'Flamengo',        short: 'FLA', city: 'Río de Janeiro', leagueId: 'l-02', colors: { primary: '#b8172c', secondary: '#141414' }, crestSeed: 2 },
  { id: 't-07', name: 'River Plate',     short: 'RIV', city: 'Buenos Aires', leagueId: 'l-02', colors: { primary: '#f4f6fb', secondary: '#d1122f' }, crestSeed: 0 },
  { id: 't-08', name: 'Palmeiras',       short: 'PAL', city: 'São Paulo',   leagueId: 'l-02', colors: { primary: '#0d6b3f', secondary: '#ffffff' }, crestSeed: 1 },

  // ---- Premier League
  { id: 't-09', name: 'Manchester City', short: 'MCI', city: 'Mánchester',  leagueId: 'l-03', colors: { primary: '#6cabdd', secondary: '#1c2c5b' }, crestSeed: 2 },
  { id: 't-10', name: 'Liverpool',       short: 'LIV', city: 'Liverpool',   leagueId: 'l-03', colors: { primary: '#c8102e', secondary: '#f2c50a' }, crestSeed: 0 },
  { id: 't-11', name: 'Arsenal',         short: 'ARS', city: 'Londres',     leagueId: 'l-03', colors: { primary: '#ef0107', secondary: '#f4f6fb' }, crestSeed: 1 },
  { id: 't-12', name: 'Chelsea',         short: 'CHE', city: 'Londres',     leagueId: 'l-03', colors: { primary: '#034694', secondary: '#f2c50a' }, crestSeed: 2 },

  // ---- LaLiga
  { id: 't-13', name: 'Real Madrid',     short: 'RMA', city: 'Madrid',      leagueId: 'l-04', colors: { primary: '#f4f6fb', secondary: '#0b3a86' }, crestSeed: 1 },
  { id: 't-14', name: 'Barcelona',       short: 'BAR', city: 'Barcelona',   leagueId: 'l-04', colors: { primary: '#004d98', secondary: '#a50044' }, crestSeed: 0 },
  { id: 't-15', name: 'Atlético Madrid', short: 'ATM', city: 'Madrid',      leagueId: 'l-04', colors: { primary: '#cb3524', secondary: '#f4f6fb' }, crestSeed: 2 },
  { id: 't-16', name: 'Sevilla',         short: 'SEV', city: 'Sevilla',     leagueId: 'l-04', colors: { primary: '#d4092a', secondary: '#f4f6fb' }, crestSeed: 1 },
];
