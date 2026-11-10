/**
 * UN pool de conexiones a MySQL para todo el proceso.
 *
 * mysql2 crea el pool sin conectarse: la primera conexion se abre con la primera
 * consulta. Eso es justo lo que pide la regla del monolito "el servicio arranca
 * aunque la base este caida": si MySQL no esta, cada consulta falla rapido
 * (UNAVAILABLE via traducirErrorBaseDatos) y apenas MySQL vuelve, el pool abre
 * conexiones nuevas solo, sin reiniciar el proceso.
 *
 * Opciones que importan:
 *  - timezone 'Z': fecha_hora es DATETIME guardado en UTC. Sin esto mysql2 lo
 *    leeria como hora local del servidor de Node y el kickoff se correria 5 horas
 *    en Colombia.
 *  - dateStrings ['DATE']: fundacion, fecha_nacimiento y las fechas de jornada
 *    llegan como 'YYYY-MM-DD'. Convertirlas a Date las pondria a medianoche
 *    local y toISOString() podria devolver el dia anterior.
 *  - Los DECIMAL llegan como cadena (para no perder precision): se convierten
 *    con aNumero() en los mapeadores.
 */

import mysql from 'mysql2/promise';

import { env } from './env.js';

let pool = null;

export function obtenerPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      // MySQL administrado (Azure, RDS) exige TLS; el certificado se valida.
      ssl: env.MYSQL_SSL ? { rejectUnauthorized: true } : undefined,
      charset: 'UTF8MB4_0900_AI_CI',
      timezone: 'Z',
      dateStrings: ['DATE'],
      connectionLimit: 10,
      maxIdle: 10,
      idleTimeout: 60_000,
      waitForConnections: true,
      queueLimit: 0,
      // Corto a proposito: mejor un UNAVAILABLE rapido que agotar el plazo del BFF.
      connectTimeout: 5_000,
      enableKeepAlive: true,
    });
  }
  return pool;
}

/** Mensaje de un error de red; los AggregateError de Node (IPv4 + IPv6) traen message vacio. */
function textoDeError(error) {
  return error?.message || error?.errors?.[0]?.message || error?.code || String(error);
}

/**
 * Traduce el error de conexion a algo que se pueda arreglar. Es texto NUESTRO:
 * va al log, a Salud y a db/setup.js, nunca el mensaje crudo del driver.
 */
export function pistaDeConexion(
  error,
  { host = env.MYSQL_HOST, port = env.MYSQL_PORT, user = env.MYSQL_USER, database = env.MYSQL_DATABASE } = {}
) {
  const destino = `${host}:${port}`;
  switch (error?.code) {
    case 'ECONNREFUSED':
      return `No hay MySQL escuchando en ${destino}. Inicia el servicio MySQL o "docker compose up -d mysql".`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `No se encontro el host "${host}". Revisa MYSQL_HOST en .env.`;
    case 'ETIMEDOUT':
      return `MySQL no respondio en ${destino} (firewall, VPN o host equivocado).`;
    case 'ER_ACCESS_DENIED_ERROR':
      return `MySQL rechazo al usuario "${user}": revisa MYSQL_USER y MYSQL_PASSWORD en .env (el README explica como crear goldorado_app).`;
    case 'ER_DBACCESS_DENIED_ERROR':
      return `El usuario "${user}" no tiene permisos sobre ${database}: GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'%'.`;
    case 'ER_BAD_DB_ERROR':
      return `La base ${database} no existe: corre "npm run db:setup" en servicios/ms-deportes.`;
    case 'ER_NO_SUCH_TABLE':
      return `Faltan las tablas de ${database}: corre "npm run db:setup" en servicios/ms-deportes.`;
    case 'HANDSHAKE_NO_SSL_SUPPORT':
      return `El servidor ${destino} no acepta TLS: pon MYSQL_SSL=false en .env.`;
    case 'PROTOCOL_CONNECTION_LOST':
      return `MySQL cerro la conexion (${destino}): ¿se reinicio el servidor?`;
    default:
      return `Error de MySQL (${error?.code ?? 'desconocido'}) en ${destino}.`;
  }
}

/** Para Salud: SELECT 1. Lanza un Error con la pista, no con el texto del driver. */
export async function comprobarConexion() {
  try {
    await obtenerPool().query('SELECT 1');
  } catch (error) {
    throw new Error(pistaDeConexion(error));
  }
}

/**
 * Intento de conexion al arrancar, SIN await en index.js: el error sale en el
 * primer segundo del log, pero no tumba el proceso. Consulta una tabla real para
 * distinguir "MySQL caido" de "base sin crear".
 */
export function probarConexionAlArrancar(log) {
  obtenerPool()
    .query('SELECT COUNT(*) AS n FROM encuentro')
    .then(([filas]) => {
      log.info(
        `MySQL listo en ${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE} (${filas[0].n} encuentros).`
      );
    })
    .catch((error) => {
      log.aviso(`Sin acceso a MySQL: ${pistaDeConexion(error)}`);
      log.aviso(`Detalle del driver: ${textoDeError(error)}`);
      log.aviso('El servicio sigue arriba; cada consulta vuelve a intentar la conexion.');
    });
}

export async function cerrar() {
  if (!pool) return;
  const actual = pool;
  pool = null;
  await actual.end();
}
