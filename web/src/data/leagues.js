/**
 * ARCHIVO DE REFERENCIA - YA NO SE IMPORTA EN NINGUNA PARTE.
 *
 * Estos datos ahora viven en SQL Server (Torneo y Temporada) y llegan por el
 * API. Se conserva porque es la fuente de server/db/02_datos.sql.
 *
 * Detalle: aqui la Copa Libertadores tiene country 'CONMEBOL', que no es un
 * pais. En la base eso se modela con Torneo.codigo_pais NULL y
 * Torneo.confederacion = 'CONMEBOL', con un CHECK que obliga a que haya
 * exactamente uno de los dos.
 *
 * ---------------------------------------------------------------------------
 * Ligas. Datos de referencia de solo lectura: NO se persisten en
 * localStorage, se importan directo. Asi se puede editar este archivo y ver
 * el cambio al instante sin limpiar el storage.
 */

export const LEAGUES = [
  { id: 'l-01', name: 'Liga BetPlay', country: 'Colombia', season: '2026-I', accent: '#e7c566' },
  { id: 'l-02', name: 'Copa Libertadores', country: 'CONMEBOL', season: '2026', accent: '#3b82f6' },
  { id: 'l-03', name: 'Premier League', country: 'Inglaterra', season: '2026/27', accent: '#a78bfa' },
  { id: 'l-04', name: 'LaLiga', country: 'España', season: '2026/27', accent: '#fb7185' },
];
