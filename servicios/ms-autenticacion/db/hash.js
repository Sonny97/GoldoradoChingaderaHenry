/**
 * Utilidad de linea de comandos: genera un hash bcrypt para pegarlo en
 * 02_datos.sql.
 *
 *   npm run db:hash -- "Demo1234!"
 *   npm run db:hash -- 482913      (codigo_hash de Solicitud_Recuperacion)
 *   npm run db:hash                (las tres claves demo del proyecto)
 *
 * Existe porque un hash bcrypt NO se puede escribir a mano: lleva un salt
 * aleatorio distinto en cada ejecucion. Si el seed trae un hash inventado, el
 * login falla siempre y no hay forma de darse cuenta leyendo el SQL (y el
 * CHECK de Usuario lo rechazaria si ni siquiera tiene la forma de un bcrypt).
 */

import bcrypt from 'bcryptjs';

// 10 rondas: las mismas del servicio (RONDAS_BCRYPT). Cada +1 duplica el costo
// de calcularlo, lo que frena un ataque por diccionario sin que el login se
// sienta lento.
const RONDAS = 10;

const CLAVES_DEMO = ['Demo1234!', 'Vale2024*', 'Admin2026#'];

const entradas = process.argv.slice(2);
const claves = entradas.length > 0 ? entradas : CLAVES_DEMO;

for (const clave of claves) {
  const hash = bcrypt.hashSync(clave, RONDAS);
  console.log(`${clave.padEnd(14)} -> ${hash}`);
}

if (entradas.length === 0) {
  console.log('\nPega estos valores en la columna password_hash de 02_datos.sql.');
}
