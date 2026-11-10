/**
 * Arranque de ms-apuestas (PostgreSQL / Azure) · gRPC :50053
 *
 * Orden: env -> servidor gRPC -> conexion a la base (NO bloqueante) -> relevo
 * de la bandeja de salida -> apagado ordenado.
 *
 * El servidor escucha aunque PostgreSQL este caido: el RPC Salud lo reporta y
 * el pool reintenta en cada consulta. Igual que el /api/salud del monolito, un
 * servicio que no arranca por la base no sirve ni para diagnosticar la base.
 */

import {
  apagadoOrdenado,
  crearLogger,
  crearRpcSalud,
  crearServidorGrpc,
  versionDelPaquete,
} from '@goldorado/comun';
import { env } from './config/env.js';
import * as db from './config/db.js';
import { crearClientes } from './clientes/index.js';
import { crearHandlers } from './grpc/handlers.js';
import { crearRepoApuestas } from './repositorios/apuestaRepo.js';
import { crearRepoBilletera } from './repositorios/billeteraRepo.js';
import { crearRepoPromociones } from './repositorios/promocionRepo.js';
import { crearRepoSalida } from './repositorios/salidaRepo.js';
import { crearServicioApuestas } from './servicios/apuestaServicio.js';
import { crearServicioBilletera } from './servicios/billeteraServicio.js';
import { crearServicioPromociones } from './servicios/promocionServicio.js';
import { crearRelevoSalida } from './servicios/relevoSalida.js';

const NOMBRE = 'ms-apuestas';
const log = crearLogger(NOMBRE);
const version = versionDelPaquete(import.meta.url);
const modo = env.PG_SSL ? 'azure' : 'local';
const destinoBase = `${env.PG_USER}@${env.PG_HOST}:${env.PG_PORT}/${env.PG_DATABASE}`;

// ------------------------------------------------------------- dependencias
const conexion = { consultar: db.consultar, enTransaccion: db.enTransaccion };
const clientes = crearClientes(env);

const apuestas = crearServicioApuestas({ repo: crearRepoApuestas(conexion), deportes: clientes.deportes, log });
const billetera = crearServicioBilletera({ repo: crearRepoBilletera(conexion), log });
const promociones = crearServicioPromociones({ repo: crearRepoPromociones(conexion) });
const relevo = crearRelevoSalida({
  repo: crearRepoSalida(conexion),
  transacciones: clientes.transacciones,
  log,
  intervaloMs: env.OUTBOX_INTERVALO_MS,
});

const salud = crearRpcSalud({
  servicio: NOMBRE,
  motor: 'PostgreSQL',
  baseDatos: env.PG_DATABASE,
  modo,
  version,
  comprobar: db.comprobarConexion,
});

// --------------------------------------------------------------- servidor gRPC
const servidor = crearServidorGrpc({ nombre: NOMBRE, log, tokenInterno: env.GRPC_TOKEN_INTERNO });
servidor.registrar('apuestas', crearHandlers({ apuestas, billetera, promociones, salud }));

let puerto;
try {
  puerto = await servidor.iniciar(env.GRPC_PUERTO, env.GRPC_HOST);
} catch (error) {
  log.error(`No se pudo abrir el puerto gRPC ${env.GRPC_HOST}:${env.GRPC_PUERTO}: ${error?.message ?? error}`);
  process.exit(1);
}
log.info(`${NOMBRE} ${version} escuchando gRPC en ${env.GRPC_HOST}:${puerto} · PostgreSQL ${destinoBase} (${modo})`);

// ------------------------------------------------- base de datos (no bloqueante)
/** Pista concreta segun el error, para no dejar al que arranca adivinando. */
function pistaConexion(error) {
  switch (error?.code) {
    case '3D000':
      return `La base ${env.PG_DATABASE} no existe: corre "npm run db:setup -w @goldorado/ms-apuestas".`;
    case '28P01':
    case '28000':
      return 'Usuario o clave rechazados: revisa PG_USER / PG_PASSWORD en el .env.';
    default:
      return env.PG_SSL
        ? 'Azure: revisa la regla de firewall del Flexible Server (tu IP o "Allow Azure services"), PG_HOST y PG_SSL=true.'
        : 'Local: levanta PostgreSQL ("docker compose up -d postgres" -> puerto 5433) o revisa PG_HOST / PG_PORT en el .env.';
  }
}

db.comprobarConexion()
  .then(() => log.info(`Conectado a PostgreSQL ${destinoBase}`))
  .catch((error) =>
    log.aviso(
      `PostgreSQL no responde en ${destinoBase}: ${error?.message ?? error}. ${pistaConexion(error)} ` +
        'El servicio sigue arriba (Salud lo reporta) y reintenta en cada consulta.'
    )
  );

relevo.iniciar();

// ------------------------------------------------------------ apagado ordenado
// Primero el relevo (que no tome un lote nuevo), luego el servidor (que
// termine lo que esta atendiendo) y al final el pool y los clientes.
apagadoOrdenado({
  log,
  tareas: [
    () => relevo.detener(),
    () => servidor.apagar(5000),
    () => db.cerrar(),
    async () => clientes.cerrar(),
  ],
});
