/**
 * ARCHIVO DE REFERENCIA - YA NO SE IMPORTA EN NINGUNA PARTE.
 *
 * Estos datos ahora viven en SQL Server (Encuentro, Encuentro_Equipo,
 * Cuota_Oferta) y llegan por el API. Se conserva porque es la fuente de la que
 * se escribio server/db/02_datos.sql. Editarlo NO cambia nada.
 *
 * Ojo con las cuotas: aqui son fracciones en texto ('3 a 5') y en la base son
 * DECIMAL en formato europeo (1.60 = 1 + 3/5). Una fraccion en texto no se
 * puede multiplicar, y Apuesta.ganancia_potencial es monto * cuota.
 *
 * ---------------------------------------------------------------------------
 * Partidos. 4 en vivo, 4 proximos, 4 finalizados.
 *
 * Guarda SOLO ids de equipo y liga. La union la hace matchService, igual que
 * lo haria una API REST embebiendo los objetos. Ningun componente resuelve
 * ids: si lo hiciera, la abstraccion de servicios ya estaria rota.
 *
 * `odds` es un ARRAY, no un objeto: calza exacto con los 4 chips del boceto
 * y OddsStrip solo hace .map(). Con claves fijas home/draw/away habria que
 * hardcodear la lista en JSX.
 */

const odds = (v1, vx, v2, vgg) => [
  { key: '1', label: 'Local', value: v1 },
  { key: 'X', label: 'Empate', value: vx },
  { key: '2', label: 'Visita', value: v2 },
  { key: 'GG', label: 'Ambos', value: vgg },
];

export const MATCHES = [
  // ---------------------------------------------------------------- EN VIVO
  {
    id: 'm-01', leagueId: 'l-01', homeTeamId: 't-01', awayTeamId: 't-02',
    homeScore: 1, awayScore: 0, status: 'live', minute: 67,
    kickoff: '2026-08-17T20:00:00.000Z', stadium: 'El Campín', featured: true,
    odds: odds('1 a 1', '3 a 5', '1 a 2', '2 a 5'),
  },
  {
    id: 'm-02', leagueId: 'l-02', homeTeamId: 't-05', awayTeamId: 't-06',
    homeScore: 0, awayScore: 2, status: 'live', minute: 34,
    kickoff: '2026-08-17T22:30:00.000Z', stadium: 'La Bombonera', featured: true,
    odds: odds('2 a 3', '3 a 4', '1 a 3', '1 a 2'),
  },
  {
    id: 'm-03', leagueId: 'l-03', homeTeamId: 't-09', awayTeamId: 't-10',
    homeScore: 2, awayScore: 2, status: 'live', minute: 81,
    kickoff: '2026-08-17T14:00:00.000Z', stadium: 'Etihad Stadium', featured: true,
    odds: odds('1 a 2', '2 a 5', '3 a 2', '1 a 4'),
  },
  {
    id: 'm-04', leagueId: 'l-04', homeTeamId: 't-13', awayTeamId: 't-14',
    homeScore: 1, awayScore: 1, status: 'live', minute: 52,
    kickoff: '2026-08-17T19:00:00.000Z', stadium: 'Santiago Bernabéu', featured: true,
    odds: odds('2 a 5', '3 a 5', '2 a 3', '1 a 3'),
  },

  // --------------------------------------------------------------- PROXIMOS
  {
    id: 'm-05', leagueId: 'l-01', homeTeamId: 't-03', awayTeamId: 't-04',
    homeScore: null, awayScore: null, status: 'upcoming', minute: null,
    kickoff: '2026-08-19T00:30:00.000Z', stadium: 'Pascual Guerrero', featured: false,
    odds: odds('1 a 1', '2 a 5', '1 a 2', '3 a 5'),
  },
  {
    id: 'm-06', leagueId: 'l-02', homeTeamId: 't-07', awayTeamId: 't-08',
    homeScore: null, awayScore: null, status: 'upcoming', minute: null,
    kickoff: '2026-08-20T01:00:00.000Z', stadium: 'Monumental', featured: false,
    odds: odds('3 a 4', '2 a 5', '1 a 2', '2 a 3'),
  },
  {
    id: 'm-07', leagueId: 'l-03', homeTeamId: 't-11', awayTeamId: 't-12',
    homeScore: null, awayScore: null, status: 'upcoming', minute: null,
    kickoff: '2026-08-21T16:30:00.000Z', stadium: 'Emirates Stadium', featured: false,
    odds: odds('2 a 3', '3 a 5', '1 a 1', '1 a 2'),
  },
  {
    id: 'm-08', leagueId: 'l-04', homeTeamId: 't-15', awayTeamId: 't-16',
    homeScore: null, awayScore: null, status: 'upcoming', minute: null,
    kickoff: '2026-08-22T19:15:00.000Z', stadium: 'Metropolitano', featured: false,
    odds: odds('1 a 2', '2 a 5', '3 a 4', '2 a 5'),
  },

  // ------------------------------------------------------------ FINALIZADOS
  {
    id: 'm-09', leagueId: 'l-01', homeTeamId: 't-02', awayTeamId: 't-03',
    homeScore: 3, awayScore: 1, status: 'finished', minute: null,
    kickoff: '2026-08-14T00:00:00.000Z', stadium: 'Atanasio Girardot', featured: false,
    odds: odds('1 a 1', '3 a 5', '2 a 5', '1 a 2'),
  },
  {
    id: 'm-10', leagueId: 'l-02', homeTeamId: 't-08', awayTeamId: 't-05',
    homeScore: 2, awayScore: 2, status: 'finished', minute: null,
    kickoff: '2026-08-13T23:00:00.000Z', stadium: 'Allianz Parque', featured: false,
    odds: odds('2 a 3', '2 a 5', '1 a 2', '1 a 3'),
  },
  {
    id: 'm-11', leagueId: 'l-03', homeTeamId: 't-12', awayTeamId: 't-09',
    homeScore: 0, awayScore: 4, status: 'finished', minute: null,
    kickoff: '2026-08-12T18:45:00.000Z', stadium: 'Stamford Bridge', featured: false,
    odds: odds('3 a 2', '2 a 5', '1 a 3', '1 a 2'),
  },
  {
    id: 'm-12', leagueId: 'l-04', homeTeamId: 't-14', awayTeamId: 't-15',
    homeScore: 2, awayScore: 0, status: 'finished', minute: null,
    kickoff: '2026-08-11T20:00:00.000Z', stadium: 'Spotify Camp Nou', featured: false,
    odds: odds('1 a 2', '3 a 5', '2 a 3', '2 a 5'),
  },
];
