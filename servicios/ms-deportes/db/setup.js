/**
 * npm run db:setup  ->  crea goldorado_deportes desde cero y carga los datos.
 *
 * Corre 01_esquema.sql (DROP + CREATE de la base y las 15 tablas) y despues
 * 02_datos.sql (una transaccion), con el mismo usuario y clave del servicio
 * (.env). Se conecta SIN base porque el primer archivo es el que la borra y la
 * crea, y con multipleStatements porque cada archivo es un guion entero.
 *
 * Es una herramienta de desarrollo: aqui SI se muestra el error crudo de MySQL
 * (codigo y mensaje), porque quien lo lee es quien tiene que arreglarlo.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import mysql from 'mysql2/promise';

import { env } from '../src/config/env.js';
import { pistaDeConexion } from '../src/config/db.js';

const DIR = dirname(fileURLToPath(import.meta.url));
const ARCHIVOS = ['01_esquema.sql', '02_datos.sql'];

/** Pistas para los errores que aparecen al CORRER los guiones (no al conectar). */
function pistaDeGuion(error) {
  switch (error?.code) {
    case 'ER_TABLE_WITHOUT_PK':
      return 'El servidor exige llave primaria en todas las tablas (sql_require_primary_key=ON) y las tablas de rompimiento no la llevan a proposito. Desactivalo para esta base o usa el MySQL local / de docker compose.';
    case 'ER_DBACCESS_DENIED_ERROR':
    case 'ER_SPECIFIC_ACCESS_DENIED_ERROR':
      return `El usuario ${env.MYSQL_USER} no puede borrar/crear la base. Como root: GRANT ALL PRIVILEGES ON ${env.MYSQL_DATABASE}.* TO '${env.MYSQL_USER}'@'%';`;
    default:
      return pistaDeConexion(error);
  }
}

/** Con multipleStatements llega un resultado por sentencia; los SELECT son arreglos de filas. */
function ultimoSelect(resultados) {
  const conjuntos = Array.isArray(resultados) ? resultados.filter(Array.isArray) : [];
  return conjuntos.at(-1) ?? [];
}

async function main() {
  console.log(`\nms-deportes · db:setup -> ${env.MYSQL_USER}@${env.MYSQL_HOST}:${env.MYSQL_PORT}\n`);
  if (env.MYSQL_DATABASE !== 'goldorado_deportes') {
    // Los guiones crean goldorado_deportes por nombre (como el monolito con ApuestasFutbol).
    console.warn(`OJO: MYSQL_DATABASE=${env.MYSQL_DATABASE}, pero los guiones crean goldorado_deportes.`);
  }

  let conexion;
  try {
    conexion = await mysql.createConnection({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      ssl: env.MYSQL_SSL ? { rejectUnauthorized: true } : undefined,
      charset: 'UTF8MB4_0900_AI_CI',
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: true,
      connectTimeout: 10_000,
    });
  } catch (error) {
    console.error(`No se pudo conectar: ${pistaDeConexion(error)}`);
    console.error(`(${error?.code ?? 'sin codigo'}) ${error?.message ?? ''}`);
    process.exitCode = 1;
    return;
  }

  try {
    // Los CHECK se respetan desde 8.0.16; antes se ignoraban en silencio.
    const [[{ version }]] = await conexion.query('SELECT VERSION() AS version');
    const [mayor = 0, menor = 0, parche = 0] = version.split(/[.-]/).map(Number);
    const viejo = mayor < 8 || (mayor === 8 && menor === 0 && parche < 16);
    console.log(`MySQL ${version}${viejo ? '  << OJO: menor que 8.0.16, los CHECK NO se aplican' : ''}`);

    let verificacion = [];
    for (const archivo of ARCHIVOS) {
      // Sin BOM: MySQL no lo entiende como espacio en blanco.
      const guion = (await readFile(join(DIR, archivo), 'utf8')).replace(/^﻿/, '');
      process.stdout.write(`-> ${archivo} ... `);
      const [resultados] = await conexion.query(guion);
      console.log('listo');
      verificacion = ultimoSelect(resultados);
    }

    console.log('\nVerificacion (minimo 2 filas por tabla):');
    console.table(verificacion.map((f) => ({ tabla: f.tabla, filas: Number(f.filas), cumple: f.cumple })));

    // Las fechas son relativas a hoy: se muestra que cada estado quedo donde debe.
    const [porEstado] = await conexion.query(`
      SELECT estado, COUNT(*) AS encuentros,
             MIN(fecha_hora) AS primer_kickoff_utc, MAX(fecha_hora) AS ultimo_kickoff_utc
      FROM goldorado_deportes.encuentro
      GROUP BY estado
      ORDER BY FIELD(estado, 'live', 'upcoming', 'finished', 'canceled')`);
    console.log('Encuentros por estado (fechas relativas a UTC_TIMESTAMP()):');
    console.table(porEstado.map((f) => ({ ...f, encuentros: Number(f.encuentros) })));

    const faltan = verificacion.filter((f) => f.cumple !== 'OK');
    if (verificacion.length !== 15 || faltan.length > 0) {
      console.error('La verificacion NO se cumple:', faltan.map((f) => f.tabla).join(', ') || 'faltan tablas');
      process.exitCode = 1;
    } else {
      console.log(`Base ${env.MYSQL_DATABASE} lista: 15 tablas, todas con al menos 2 filas.`);
    }
  } catch (error) {
    // 02_datos.sql abre una transaccion: si algo fallo a mitad, no queda nada a medias.
    await conexion.query('ROLLBACK').catch(() => {});
    console.error('\nFALLO');
    console.error(`MySQL ${error?.code ?? ''} (${error?.errno ?? '-'}): ${error?.sqlMessage ?? error?.message ?? error}`);
    console.error(`Pista: ${pistaDeGuion(error)}`);
    process.exitCode = 1;
  } finally {
    await conexion.end().catch(() => {});
  }
}

await main();
