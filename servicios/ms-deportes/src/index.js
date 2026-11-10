/**
 * Arranque de ms-deportes (MySQL, gRPC 50052).
 *
 * Orden: entorno -> servidor gRPC -> conexion a MySQL SIN bloquear -> apagado
 * ordenado. El puerto se abre aunque MySQL este caido: Salud responde
 * estado 'error' con la pista, cada RPC de datos responde UNAVAILABLE, y en
 * cuanto MySQL vuelve el pool se reconecta solo. Es la misma regla del monolito
 * con /api/salud.
 */

import { apagadoOrdenado, crearLogger, crearRpcSalud, crearServidorGrpc, versionDelPaquete } from '@goldorado/comun';

import { env } from './config/env.js';
import { cerrar, comprobarConexion, obtenerPool, probarConexionAlArrancar } from './config/db.js';
import { crearHandlers } from './grpc/handlers.js';
import { crearCatalogoRepo } from './repositorios/catalogoRepo.js';
import { crearEncuentroRepo } from './repositorios/encuentroRepo.js';
import { crearServicioDeportes } from './servicios/deportesServicio.js';

const NOMBRE = 'ms-deportes';
const log = crearLogger(NOMBRE);

if (!env.MYSQL_PASSWORD) {
  log.aviso('MYSQL_PASSWORD esta vacia: ¿copiaste .env.example a .env?');
}

// mysql2 crea el pool sin conectarse; la primera consulta abre la conexion.
const pool = obtenerPool();

const servicio = crearServicioDeportes({
  catalogoRepo: crearCatalogoRepo({ pool }),
  encuentroRepo: crearEncuentroRepo({ pool }),
});

const salud = crearRpcSalud({
  servicio: NOMBRE,
  motor: 'MySQL',
  baseDatos: env.MYSQL_DATABASE,
  version: versionDelPaquete(import.meta.url),
  comprobar: comprobarConexion,
});

const servidor = crearServidorGrpc({ nombre: NOMBRE, log, tokenInterno: env.GRPC_TOKEN_INTERNO });
servidor.registrar('deportes', crearHandlers({ servicio, salud }));

let puerto;
try {
  puerto = await servidor.iniciar(env.GRPC_PUERTO, env.GRPC_HOST);
} catch (error) {
  // Sin puerto el servicio no sirve para nada: aqui si se termina el proceso.
  log.error(`No se pudo abrir el puerto gRPC ${env.GRPC_HOST}:${env.GRPC_PUERTO}: ${error?.message ?? error}`);
  process.exit(1);
}

log.info(
  `gRPC escuchando en ${env.GRPC_HOST}:${puerto} · MySQL ${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`
);

// Sin await: si MySQL no esta, el aviso sale en el primer segundo pero el
// proceso sigue arriba.
probarConexionAlArrancar(log);

// Primero se deja de recibir llamadas, despues se cierra el pool.
apagadoOrdenado({
  log,
  tareas: [() => servidor.apagar(5000), () => cerrar()],
});
