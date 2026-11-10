/**
 * UN pool de conexiones a PostgreSQL para todo el proceso.
 *
 * El pool de `pg` se conecta de forma perezosa: crearlo no abre nada, y si la
 * base esta caida cada consulta vuelve a intentar. Por eso el servicio arranca
 * aunque PostgreSQL no responda (lo dice el RPC Salud) y se recupera solo
 * cuando la base vuelve, sin reiniciar el proceso.
 *
 * Mismo codigo en local y en Azure Database for PostgreSQL (Flexible Server):
 * solo cambia el .env (PG_SSL=true).
 */

import pg from 'pg';
import { crearLogger } from '@goldorado/comun';
import { env } from './env.js';

const log = crearLogger('ms-apuestas');

const OID_DATE = 1082;

/**
 * Tipos devueltos por el driver.
 *
 * DATE se deja como texto 'YYYY-MM-DD'. El parser por defecto de pg lo convierte
 * en un Date a la medianoche LOCAL del proceso; en Colombia (UTC-5) eso es
 * 05:00 UTC del mismo dia y en una zona UTC+X es la noche del dia ANTERIOR en
 * UTC, asi que toISOString() mostraria la promo venciendo un dia antes segun la
 * maquina que corra el servicio. Una fecha sin hora no tiene zona: se pasa tal cual.
 *
 * NUMERIC tambien llega como texto (pg no lo convierte para no perder
 * precision): los repositorios lo pasan a number con aNumero() en el borde.
 * TIMESTAMPTZ llega como Date y se envia en ISO UTC con aFechaHoraIso().
 */
const tipos = {
  getTypeParser(oid, formato) {
    if (oid === OID_DATE) return (valor) => valor;
    return pg.types.getTypeParser(oid, formato);
  },
};

/** Configuracion compartida por el pool y por db/setup.js. */
export function configuracionConexion(baseDatos = env.PG_DATABASE) {
  return {
    host: env.PG_HOST,
    port: env.PG_PORT,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    database: baseDatos,
    // Azure exige TLS. rejectUnauthorized=false cifra sin validar la cadena
    // de certificados (comodo en clase); PG_SSL_VERIFICAR=true la valida.
    ssl: env.PG_SSL ? { rejectUnauthorized: env.PG_SSL_VERIFICAR } : false,
    // Sin esto, con la base caida una consulta esperaria el timeout del SO.
    connectionTimeoutMillis: 5000,
    // El gateway de Azure corta conexiones inactivas: keepAlive las mantiene.
    keepAlive: true,
    // Topes del lado del servidor: ninguna consulta ni transaccion abierta
    // (p. ej. la del relevo esperando a ms-transacciones) se queda colgada.
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
    application_name: 'ms-apuestas',
    types: tipos,
  };
}

let pool = null;

export function obtenerPool() {
  if (!pool) {
    pool = new pg.Pool({ ...configuracionConexion(), max: env.PG_POOL_MAX, idleTimeoutMillis: 30000 });
    // Un cliente inactivo que pierde la conexion emite 'error' en el pool; sin
    // este manejador, Node lo trataria como excepcion no capturada y tumbaria
    // el proceso entero por un corte de red.
    pool.on('error', (error) => log.aviso(`Conexion inactiva de PostgreSQL perdida: ${error.message}`));
  }
  return pool;
}

/** Consulta suelta (cada sentencia es atomica por si sola). */
export function consultar(texto, valores = []) {
  return obtenerPool().query(texto, valores);
}

/**
 * Ejecuta `trabajo(cliente)` dentro de BEGIN/COMMIT con UNA conexion del pool.
 * Cualquier excepcion hace ROLLBACK y se relanza. Si el ROLLBACK tambien falla
 * (la conexion murio), el cliente se descarta en vez de devolverlo al pool.
 */
export async function enTransaccion(trabajo) {
  const cliente = await obtenerPool().connect();
  let descartar = false;
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    try {
      await cliente.query('ROLLBACK');
    } catch {
      descartar = true;
    }
    throw error;
  } finally {
    cliente.release(descartar);
  }
}

/** Para el RPC Salud y el aviso de arranque. */
export async function comprobarConexion() {
  await consultar('SELECT 1');
}

export async function cerrar() {
  if (!pool) return;
  const actual = pool;
  pool = null;
  await actual.end();
}
