/**
 * Los 16 equipos semilla, en el MISMO orden (ids 1..16) que ms-deportes y
 * que server/db/02_datos.sql del monolito: codigo, colores y crest_seed.
 * Con estos datos db/setup.js genera y sube los 16 escudos SVG
 * (appProperties entidad='equipo', idEntidad='1'..'16').
 */

export const EQUIPOS = Object.freeze([
  // Liga BetPlay
  { id: 1, nombre: 'Millonarios', codigo: 'MIL', primario: '#123a8f', secundario: '#ffffff', crestSeed: 0 },
  { id: 2, nombre: 'Atlético Nacional', codigo: 'NAL', primario: '#0f8a3c', secundario: '#f7e9b8', crestSeed: 1 },
  { id: 3, nombre: 'América de Cali', codigo: 'AME', primario: '#c8102e', secundario: '#ffffff', crestSeed: 2 },
  { id: 4, nombre: 'Junior', codigo: 'JUN', primario: '#e8d21c', secundario: '#c8102e', crestSeed: 0 },
  // Copa Libertadores
  { id: 5, nombre: 'Boca Juniors', codigo: 'BOC', primario: '#0b3a86', secundario: '#f2c50a', crestSeed: 1 },
  { id: 6, nombre: 'Flamengo', codigo: 'FLA', primario: '#b8172c', secundario: '#141414', crestSeed: 2 },
  { id: 7, nombre: 'River Plate', codigo: 'RIV', primario: '#f4f6fb', secundario: '#d1122f', crestSeed: 0 },
  { id: 8, nombre: 'Palmeiras', codigo: 'PAL', primario: '#0d6b3f', secundario: '#ffffff', crestSeed: 1 },
  // Premier League
  { id: 9, nombre: 'Manchester City', codigo: 'MCI', primario: '#6cabdd', secundario: '#1c2c5b', crestSeed: 2 },
  { id: 10, nombre: 'Liverpool', codigo: 'LIV', primario: '#c8102e', secundario: '#f2c50a', crestSeed: 0 },
  { id: 11, nombre: 'Arsenal', codigo: 'ARS', primario: '#ef0107', secundario: '#f4f6fb', crestSeed: 1 },
  { id: 12, nombre: 'Chelsea', codigo: 'CHE', primario: '#034694', secundario: '#f2c50a', crestSeed: 2 },
  // LaLiga
  { id: 13, nombre: 'Real Madrid', codigo: 'RMA', primario: '#f4f6fb', secundario: '#0b3a86', crestSeed: 1 },
  { id: 14, nombre: 'Barcelona', codigo: 'BAR', primario: '#004d98', secundario: '#a50044', crestSeed: 0 },
  { id: 15, nombre: 'Atlético Madrid', codigo: 'ATM', primario: '#cb3524', secundario: '#f4f6fb', crestSeed: 2 },
  { id: 16, nombre: 'Sevilla', codigo: 'SEV', primario: '#d4092a', secundario: '#f4f6fb', crestSeed: 1 },
]);
