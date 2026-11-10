/**
 * Las 5 categorias exactas del boceto.
 *
 * `filter` alimenta la consulta de HomePage, asi los tiles hacen algo real
 * en vez de ser decorativos. Cuando existan rutas propias (/partidos,
 * /ligas...) se cambia el <button> por un <Link> y este archivo no cambia.
 */

export const CATEGORIES = [
  { id: 'c-partidos',  label: 'Partidos',  icon: 'Football',    filter: 'all' },
  { id: 'c-equipos',   label: 'Equipos',   icon: 'Crest',       filter: 'live' },
  { id: 'c-ligas',     label: 'Ligas',     icon: 'Shield',      filter: 'upcoming' },
  { id: 'c-ganadores', label: 'Ganadores', icon: 'Trophy',      filter: 'finished' },
  { id: 'c-efutbol',   label: 'E-Fútbol',  icon: 'Gamepad',     filter: 'esports' },
];
