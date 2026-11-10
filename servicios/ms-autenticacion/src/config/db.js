/**
 * Pool de conexiones a SQL Server (base GolDoradoAuth).
 *
 * UN SOLO POOL para todo el proceso, igual que el monolito: abrir una conexion
 * por peticion paga el handshake TCP + login de SQL Server en cada llamada y
 * agota las conexiones del servidor con muy poca carga.
 *
 * Este modulo es el UNICO que sabe conectarse. Los repositorios piden
 * peticion() / enTransaccion() y no conocen ni el host ni la contraseña.
 *
 * El servicio arranca aunque la base este caida: obtenerPool() se reintenta en
 * cada llamada (la promesa se limpia al fallar) y Salud lo reporta.
 */

import sql from 'mssql';
import { crearLogger } from '@goldorado/comun';
import { env } from './env.js';

const log = crearLogger('ms-autenticacion');

export const configuracionSql = {
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  server: env.DB_SERVER,
  port: env.DB_PORT,
  database: env.DB_DATABASE,
  // Cortos a proposito: con la base caida, una peticion debe fallar rapido con
  // UNAVAILABLE en vez de dejar al BFF esperando el plazo completo.
  connectionTimeout: 8000,
  requestTimeout: 15000,
  options: {
    encrypt: env.DB_ENCRYPT,
    trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE,
    // Todas las fechas de esta base son UTC (SYSUTCDATETIME()). Sin useUTC el
    // driver las leeria como hora local y una sesion "venceria" horas corrida.
    useUTC: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromesa = null;

/**
 * Devuelve el pool conectado, creandolo la primera vez.
 *
 * Se guarda la PROMESA, no el pool: si llegan tres peticiones mientras aun se
 * conecta, las tres esperan el mismo intento en vez de abrir tres pools.
 */
export function obtenerPool() {
  if (!poolPromesa) {
    const pool = new sql.ConnectionPool(configuracionSql);
    // Un 'error' sin escuchar tumbaria el proceso (EventEmitter de Node).
    pool.on('error', (error) => log.aviso(`Pool de SQL Server: ${error.message}`));

    poolPromesa = pool
      .connect()
      .then((conectado) => {
        log.info(`Conectado a SQL Server ${env.DB_SERVER}:${env.DB_PORT} / ${env.DB_DATABASE}`);
        return conectado;
      })
      .catch((error) => {
        // Se limpia para que el siguiente intento vuelva a probar. Sin esto, un
        // fallo momentaneo al arrancar dejaria el servicio caido para siempre
        // aunque la base ya hubiera vuelto.
        poolPromesa = null;
        pool.close().catch(() => {});
        throw error;
      });
  }
  return poolPromesa;
}

/** Un request nuevo del pool: lo que usan las consultas sueltas. */
export async function peticion() {
  const pool = await obtenerPool();
  return pool.request();
}

/**
 * Ejecuta `trabajo(nuevaPeticion)` dentro de BEGIN TRAN / COMMIT.
 *
 * Si algo falla, ROLLBACK: o quedan todas las filas o no queda ninguna. El
 * rollback puede fallar si el motor ya aborto la transaccion por su cuenta; ese
 * error se ignora para no tapar el original, que es el que explica que paso.
 */
export async function enTransaccion(trabajo) {
  const pool = await obtenerPool();
  const transaccion = new sql.Transaction(pool);
  await transaccion.begin();
  try {
    const resultado = await trabajo(() => new sql.Request(transaccion));
    await transaccion.commit();
    return resultado;
  } catch (error) {
    try {
      await transaccion.rollback();
    } catch {
      // ya abortada por SQL Server
    }
    throw error;
  }
}

/**
 * Nombre de la restriccion UNIQUE / PK que hizo fallar un INSERT (errores 2627
 * y 2601), o null si el error es otro.
 *
 * Existe para la CARRERA entre el SELECT de "ya existe?" y el INSERT: ahi quien
 * decide es la restriccion, y el repositorio necesita saber CUAL salto para que
 * el servicio diga "ese correo" o "ese documento". Se busca el nombre entre
 * comillas, que aparece igual en el mensaje en ingles y en el de una
 * instalacion en español ("Infraccion de la restriccion UNIQUE KEY 'UQ_...'").
 * Por eso toda restriccion va nombrada.
 */
export function restriccionUnicaViolada(error, candidatas) {
  const numero = error?.number ?? error?.originalError?.info?.number;
  if (numero !== 2627 && numero !== 2601) return null;
  const mensaje = `${error?.message ?? ''} ${error?.originalError?.info?.message ?? ''}`;
  return candidatas.find((nombre) => mensaje.includes(`'${nombre}'`)) ?? null;
}

/** Consulta trivial para el RPC Salud. */
export async function comprobarConexion() {
  const consulta = await peticion();
  await consulta.query('SELECT 1 AS ok');
}

/**
 * Traduce los dos fallos que se ven en clase a una instruccion concreta: casi
 * nunca es el codigo, casi siempre es la configuracion de SQL Server.
 */
export function pistaDeConexion(error) {
  if (error?.code === 'ELOGIN') {
    return (
      `Login rechazado para ${env.DB_USER}. Revisa DB_USER/DB_PASSWORD, que SQL Server este en ` +
      'autenticacion mixta (SQL Server y Windows) y que la base exista (npm run db:setup).'
    );
  }
  if (error?.code === 'ESOCKET' || error?.code === 'ETIMEOUT') {
    return (
      `Sin respuesta en ${env.DB_SERVER}:${env.DB_PORT}. Habilita TCP/IP en SQL Server ` +
      'Configuration Manager con el puerto 1433 en IPAll (docker compose usa 1434).'
    );
  }
  return 'Revisa las variables DB_* del .env.';
}

/** Cierra el pool. Lo llama apagadoOrdenado() al recibir SIGINT/SIGTERM. */
export async function cerrarPool() {
  if (!poolPromesa) return;
  try {
    const pool = await poolPromesa;
    await pool.close();
  } catch {
    // Cerrar un pool que nunca llego a abrir no es un error que valga reportar.
  } finally {
    poolPromesa = null;
  }
}

/** Se reexporta para que los repositorios tipen parametros sin importar mssql. */
export { sql };
