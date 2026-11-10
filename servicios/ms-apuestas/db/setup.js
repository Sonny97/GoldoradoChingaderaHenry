/**
 * npm run db:setup -> prepara goldorado_apuestas (PostgreSQL local o Azure).
 *
 * 1. Entra a la base de mantenimiento 'postgres' y crea PG_DATABASE si no
 *    existe. Si el usuario no puede (en Azure el de la aplicacion no suele
 *    tener CREATEDB) avisa y sigue: la base se crea una vez desde el portal o
 *    con az CLI (ver README).
 * 2. Corre db/01_esquema.sql y db/02_datos.sql sobre PG_DATABASE. Los dos son
 *    re-ejecutables: no hace falta DROP DATABASE para empezar de cero.
 * 3. Muestra cuantas filas quedaron por tabla.
 *
 * Usa la misma configuracion de conexion que el servicio (PG_SSL y
 * PG_SSL_VERIFICAR incluidos), asi que si esto conecta, el servicio tambien.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../src/config/env.js';
import { configuracionConexion } from '../src/config/db.js';

const CARPETA = dirname(fileURLToPath(import.meta.url));
const TABLAS = [
  'tipo_mercado',
  'opcion_mercado',
  'regla_apuesta',
  'cuota_oferta',
  'cuenta_saldo',
  'apuesta',
  'movimiento_saldo',
  'promocion',
  'promocion_torneo',
  'evento_salida',
];
// CREATE DATABASE no admite parametros ($1): el nombre se valida con esta
// expresion antes de ponerlo en el texto de la sentencia.
const IDENTIFICADOR_SIMPLE = /^[a-z_][a-z0-9_]{0,62}$/;

async function conectar(baseDatos) {
  const cliente = new pg.Client(configuracionConexion(baseDatos));
  await cliente.connect();
  return cliente;
}

async function asegurarBase(nombre) {
  let cliente;
  try {
    cliente = await conectar('postgres');
  } catch (error) {
    console.warn(`! No se pudo entrar a la base "postgres" (${error.message}). Se asume que ${nombre} ya existe.`);
    return;
  }

  try {
    const existe = await cliente.query('SELECT pg_encoding_to_char(encoding) AS codificacion FROM pg_database WHERE datname = $1', [nombre]);
    if (existe.rowCount > 0) {
      console.log(`- La base ${nombre} ya existe (${existe.rows[0].codificacion})`);
      return;
    }
    await cliente.query(`CREATE DATABASE ${nombre}`);
    const creada = await cliente.query('SELECT pg_encoding_to_char(encoding) AS codificacion FROM pg_database WHERE datname = $1', [nombre]);
    const codificacion = creada.rows[0]?.codificacion;
    console.log(`+ Base ${nombre} creada (${codificacion})`);
    if (codificacion !== 'UTF8') {
      console.warn('! La base no quedo en UTF8: las tildes de los datos semilla podrian verse mal.');
    }
  } catch (error) {
    // 42501 = insufficient_privilege: el usuario no tiene CREATEDB.
    if (error.code !== '42501') throw error;
    console.warn(
      `! ${env.PG_USER} no puede crear bases. Creala una vez (portal de Azure, az CLI o un usuario administrador) y vuelve a correr este script.`
    );
  } finally {
    await cliente.end();
  }
}

async function ejecutarArchivo(cliente, archivo) {
  const texto = await readFile(join(CARPETA, archivo), 'utf8');
  // Sin parametros, pg usa el protocolo simple: acepta el archivo entero con
  // varias sentencias, sus BEGIN/COMMIT y sus bloques DO.
  await cliente.query(texto);
  console.log(`+ ${archivo}`);
}

async function principal() {
  const nombre = env.PG_DATABASE;
  if (!IDENTIFICADOR_SIMPLE.test(nombre)) {
    throw new Error(`PG_DATABASE "${nombre}" debe ser un identificador simple (minusculas, digitos y _).`);
  }

  console.log(`PostgreSQL ${env.PG_USER}@${env.PG_HOST}:${env.PG_PORT} · SSL ${env.PG_SSL ? 'si' : 'no'}`);
  await asegurarBase(nombre);

  const cliente = await conectar(nombre);
  try {
    await ejecutarArchivo(cliente, '01_esquema.sql');
    await ejecutarArchivo(cliente, '02_datos.sql');

    const conteo = TABLAS.map((tabla) => `SELECT '${tabla}' AS tabla, count(*)::int AS filas FROM ${tabla}`).join(
      ' UNION ALL '
    );
    const { rows } = await cliente.query(conteo);
    console.table(rows);
    console.log(`Listo: ${nombre} con esquema y datos semilla. Consultas de sustentacion en db/03_consultas.sql`);
  } finally {
    await cliente.end();
  }
}

principal().catch((error) => {
  console.error(`\nNo se pudo preparar la base: ${error.message}`);
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    console.error(
      env.PG_SSL
        ? 'Azure: revisa PG_HOST y la regla de firewall del Flexible Server para tu IP.'
        : 'Local: "docker compose up -d postgres" (puerto 5433) o revisa PG_HOST / PG_PORT en el .env.'
    );
  }
  process.exitCode = 1;
});
