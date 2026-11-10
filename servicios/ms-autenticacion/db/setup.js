/**
 * Crea la base GolDoradoAuth desde cero y la siembra.
 *
 *   npm run db:setup
 *
 * DOS DETALLES QUE NO SON OBVIOS (los mismos del monolito)
 *
 * 1) GO no es T-SQL. Es un separador de lotes que entienden SSMS y sqlcmd, no
 *    el motor. Si se le manda el archivo completo al driver responde
 *    "Incorrect syntax near 'GO'". Por eso el archivo se parte en lotes y se
 *    mandan de a uno.
 *
 * 2) Se conecta a `master`, no a GolDoradoAuth: la base no existe la primera
 *    vez, y ademas 01_esquema.sql la borra. El pool se limita a UNA conexion
 *    (max: 1) para que el `USE GolDoradoAuth` de un lote siga vigente en el
 *    siguiente; con varias conexiones un lote podria salir por una que sigue
 *    apuntando a master.
 *
 * Solo lee las variables DB_*: crear la base no necesita JWT_SECRET.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { cargarEnv } from '@goldorado/comun';
import { ESQUEMA_BASE_DATOS } from '../src/config/esquemaEnv.js';

const aqui = dirname(fileURLToPath(import.meta.url));

/** 01_esquema.sql crea la base con este nombre fijo (como el monolito). */
const BASE_DEL_SCRIPT = 'GolDoradoAuth';

const ARCHIVOS = [
  { nombre: '01_esquema.sql', descripcion: 'estructura (10 tablas)' },
  { nombre: '02_datos.sql', descripcion: 'datos semilla con ids fijos' },
];

/**
 * Parte un script en lotes por las lineas que contienen solo GO.
 *
 * El GO puede llevar espacios alrededor y venir en cualquier combinacion de
 * mayusculas. Se descartan los lotes vacios o solo con comentarios: mandarle
 * una cadena en blanco al driver es un error.
 */
export function partirEnLotes(script) {
  return script
    .split(/^[ \t]*GO[ \t]*(?:--.*)?$/gim)
    .map((lote) => lote.trim())
    .filter((lote) => lote.length > 0)
    .filter((lote) => !/^(--[^\n]*\n?)*$/.test(lote));
}

async function ejecutarArchivo(pool, { nombre, descripcion }) {
  const script = await readFile(join(aqui, nombre), 'utf8');
  const lotes = partirEnLotes(script);

  console.log(`\n> ${nombre}  (${descripcion}) - ${lotes.length} lotes`);

  for (let i = 0; i < lotes.length; i += 1) {
    const peticion = pool.request();
    // Los PRINT del script llegan como eventos 'info', no en el resultado.
    peticion.on('info', (info) => console.log(`  ${info.message}`));
    try {
      const resultado = await peticion.batch(lotes[i]);
      // La verificacion al final de 02_datos.sql devuelve filas: se muestran
      // para no tener que abrir SSMS solo para comprobarlas.
      for (const conjunto of resultado.recordsets ?? []) {
        if (conjunto.length > 0) console.table(conjunto);
      }
    } catch (error) {
      // El numero de lote y sus primeras lineas ubican el problema al instante.
      const inicio = lotes[i].split('\n').slice(0, 3).join('\n');
      console.error(`\n[X] Fallo el lote ${i + 1} de ${nombre}:\n${inicio}\n`);
      throw error;
    }
  }

  console.log(`  OK ${nombre}`);
}

async function main(env) {
  console.log(`[goldorado] db:setup -> ${env.DB_SERVER}:${env.DB_PORT} como ${env.DB_USER}`);
  if (env.DB_DATABASE !== BASE_DEL_SCRIPT) {
    console.warn(
      `[!] DB_DATABASE=${env.DB_DATABASE}, pero 01_esquema.sql crea ${BASE_DEL_SCRIPT}. ` +
        'El servicio buscara una base que este script no crea.'
    );
  }

  const pool = new sql.ConnectionPool({
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    server: env.DB_SERVER,
    port: env.DB_PORT,
    database: 'master',
    options: {
      encrypt: env.DB_ENCRYPT,
      trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
      useUTC: true,
    },
    // Una sola conexion: ver el comentario de arriba sobre USE.
    pool: { max: 1, min: 1, idleTimeoutMillis: 60000 },
    requestTimeout: 60000,
  });
  pool.on('error', (error) => console.error('[pool]', error.message));

  await pool.connect();
  try {
    for (const archivo of ARCHIVOS) {
      await ejecutarArchivo(pool, archivo);
    }
    console.log(
      `\n[OK] Base ${BASE_DEL_SCRIPT} creada y sembrada.\n` +
        '     Cuentas demo: demo@goldorado.co / Demo1234!            (id 1, cliente)\n' +
        '                   valentina.mesa@hotmail.com / Vale2024*   (id 2, cliente + Microsoft de demo)\n' +
        '                   admin@goldorado.co / Admin2026#          (id 3, admin, sin ficha de Cliente)\n' +
        '                   andres.gomez.demo@gmail.com              (id 4, solo Google de demo, perfil incompleto)\n' +
        '     Codigo de recuperacion en desarrollo: 482913 (OTP_CODIGO_DEV)\n'
    );
  } finally {
    await pool.close();
  }
}

/**
 * Solo se ejecuta si este archivo se invoco directamente (npm run db:setup).
 *
 * Sin esta guarda, importar el modulo para reutilizar partirEnLotes -- desde
 * una prueba, por ejemplo -- borraria y recrearia la base como efecto
 * colateral de un simple `import`.
 */
const invocadoDirectamente =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invocadoDirectamente) {
  const env = cargarEnv(import.meta.url, ESQUEMA_BASE_DATOS);
  main(env).catch((error) => {
    console.error('\n[X] db:setup fallo:', error.message);

    // ELOGIN y ESOCKET son los dos fallos que se ven en clase: casi siempre es
    // autenticacion mixta o TCP/IP sin habilitar, no el script SQL.
    if (error.code === 'ELOGIN') {
      console.error(
        '    Login rechazado. Revisa DB_USER/DB_PASSWORD y que SQL Server este en\n' +
          '    modo de autenticacion mixta (SQL Server y Windows). El login necesita\n' +
          '    el rol dbcreator para crear la base (ver README).'
      );
    }
    if (error.code === 'ESOCKET' || error.code === 'ETIMEOUT') {
      console.error(
        `    No hubo respuesta en ${env.DB_SERVER}:${env.DB_PORT}. Habilita TCP/IP en\n` +
          '    SQL Server Configuration Manager y fija el puerto 1433 en IPAll\n' +
          '    (con docker compose el puerto es 1434 y el usuario sa).'
      );
    }

    process.exitCode = 1;
  });
}
