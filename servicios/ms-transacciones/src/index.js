// =============================================================================
//  Arranque de ms-transacciones (MongoDB, gRPC 50054).
//
//  Orden deliberado (CONVENCIONES §2):
//   1. env       si falta o sobra algo, se cae YA con un mensaje claro.
//   2. gRPC      el servidor queda escuchando aunque Mongo este caido: Salud
//                lo reporta y los demas RPC responden UNAVAILABLE.
//   3. MongoDB   en segundo plano: ping + colecciones/validadores/indices,
//                con reintentos. Nunca tumba el proceso.
//   4. apagado   primero el servidor gRPC, luego el pool de Mongo.
// =============================================================================

import {
  apagadoOrdenado,
  crearLogger,
  crearRpcSalud,
  crearServidorGrpc,
  resumenEnv,
  versionDelPaquete,
} from '@goldorado/comun';
import { env, ESQUEMA_ENV } from './config/env.js';
import { crearConexion } from './config/db.js';
import { asegurarEsquema, COLECCIONES } from './esquema.js';
import { crearRepositorioTransacciones } from './repositorios/transacciones.js';
import { crearRepositorioSeguridad } from './repositorios/seguridad.js';
import { crearServicioTransacciones } from './servicios/transacciones.js';
import { crearServicioSeguridad } from './servicios/seguridad.js';
import { crearHandlers } from './grpc/handlers.js';

const NOMBRE = 'ms-transacciones';
const log = crearLogger(NOMBRE);
log.debug('Configuracion:', resumenEnv(env, ESQUEMA_ENV));

const conexion = crearConexion({
  uri: env.MONGO_URI,
  nombreBase: env.MONGO_DB,
  log,
  alConectar: (db) => asegurarEsquema(db, { log, diasLogsSesion: env.LOGS_SESION_DIAS }),
});

const transacciones = crearServicioTransacciones({
  repo: crearRepositorioTransacciones(() => conexion.coleccion(COLECCIONES.transacciones)),
});
const seguridad = crearServicioSeguridad({
  repo: crearRepositorioSeguridad({
    logsSesion: () => conexion.coleccion(COLECCIONES.logsSesion),
    eventos: () => conexion.coleccion(COLECCIONES.eventosSeguridad),
  }),
});

const salud = crearRpcSalud({
  servicio: NOMBRE,
  motor: 'MongoDB',
  baseDatos: env.MONGO_DB,
  // Distingue "Mongo responde pero aun no se verificaron validadores/indices".
  modo: () => (conexion.estado.esquemaListo ? 'esquema verificado' : 'esquema pendiente'),
  version: versionDelPaquete(import.meta.url),
  comprobar: () => conexion.ping(),
});

const servidor = crearServidorGrpc({ nombre: NOMBRE, log, tokenInterno: env.GRPC_TOKEN_INTERNO });
servidor.registrar('transacciones', crearHandlers({ transacciones, seguridad, salud }));
const puerto = await servidor.iniciar(env.GRPC_PUERTO, env.GRPC_HOST);
log.info(`gRPC escuchando en ${env.GRPC_HOST}:${puerto} (base ${env.MONGO_DB})`);

conexion.conectarEnSegundoPlano();

apagadoOrdenado({
  log,
  tareas: [() => servidor.apagar(5000), () => conexion.cerrar()],
});
