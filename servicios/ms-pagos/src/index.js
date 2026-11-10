/**
 * Arranque de ms-pagos (Firebase Cloud Firestore + Wompi) · gRPC :50055
 *
 * Orden: env -> almacen (memoria o Firestore, sin bloquear) -> pasarela
 * (simulada, sandbox o produccion) -> servidor gRPC -> conciliacion -> apagado
 * ordenado.
 *
 * El servidor escucha aunque Firestore no responda o falten las credenciales:
 * Salud lo reporta. Igual que el /api/salud del monolito, un servicio que no
 * arranca por la base no sirve ni para diagnosticar la base.
 */

import {
  apagadoOrdenado,
  crearLogger,
  crearRpcSalud,
  crearServidorGrpc,
  versionDelPaquete,
} from '@goldorado/comun';
import { env } from './config/env.js';
import { crearClientes } from './clientes/index.js';
import { crearHandlers } from './grpc/handlers.js';
import { crearAlmacen } from './repositorios/index.js';
import { crearConciliacion } from './servicios/conciliacion.js';
import { crearServicioPagos } from './servicios/pagoServicio.js';
import { crearPasarela, llavesFaltantes } from './wompi/index.js';

const NOMBRE = 'ms-pagos';
const log = crearLogger(NOMBRE);
const version = versionDelPaquete(import.meta.url);
const modo = `${env.PAGOS_ALMACEN}/${env.WOMPI_MODO}`;

// ------------------------------------------------------------- dependencias
const almacen = await crearAlmacen(env);
const pasarela = crearPasarela(env, { repo: almacen.repo, log });
const clientes = crearClientes(env);

const pagos = crearServicioPagos({
  repo: almacen.repo,
  pasarela,
  apuestas: clientes.apuestas,
  transacciones: clientes.transacciones,
  log,
  config: {
    montoMinimo: env.PAGOS_MONTO_MINIMO,
    montoMaximo: env.PAGOS_MONTO_MAXIMO,
    secretoEventos: env.WOMPI_SECRETO_EVENTOS,
    ambiente: env.WOMPI_MODO,
  },
});
const conciliacion = crearConciliacion({ servicio: pagos, log, intervaloMs: env.CONCILIACION_INTERVALO_MS });

const salud = crearRpcSalud({
  servicio: NOMBRE,
  motor: 'Firestore',
  baseDatos: almacen.baseDatos,
  modo,
  version,
  comprobar: almacen.comprobar,
});

// --------------------------------------------------------------- servidor gRPC
const servidor = crearServidorGrpc({ nombre: NOMBRE, log, tokenInterno: env.GRPC_TOKEN_INTERNO });
servidor.registrar('pagos', crearHandlers({ pagos, salud }));

let puerto;
try {
  puerto = await servidor.iniciar(env.GRPC_PUERTO, env.GRPC_HOST);
} catch (error) {
  log.error(`No se pudo abrir el puerto gRPC ${env.GRPC_HOST}:${env.GRPC_PUERTO}: ${error?.message ?? error}`);
  process.exit(1);
}
log.info(`${NOMBRE} ${version} escuchando gRPC en ${env.GRPC_HOST}:${puerto} · ${almacen.descripcion} · Wompi ${env.WOMPI_MODO}`);

// ------------------------------------------------------- avisos de configuracion
const faltan = llavesFaltantes(env);
if (faltan.length) {
  log.aviso(
    `WOMPI_MODO=${env.WOMPI_MODO} pero faltan ${faltan.join(', ')} en el .env. ` +
      'Copialas de comercios.wompi.co -> Desarrolladores (ver docs/WOMPI.md) o usa WOMPI_MODO=simulado.'
  );
}
if (env.WOMPI_MODO === 'simulado') {
  log.info('Wompi SIMULADO: banco "1" aprueba y "2" rechaza; no se llama a Wompi.');
}

// ------------------------------------------------ Firestore (no bloqueante)
if (env.PAGOS_ALMACEN === 'firestore') {
  almacen
    .comprobar()
    .then(() => log.info(`Conectado a ${almacen.descripcion}`))
    .catch((error) =>
      log.aviso(
        `Firestore no responde (${almacen.descripcion}): ${error?.message ?? error}. ` +
          'Revisa FIREBASE_CREDENCIALES / FIREBASE_PROJECT_ID (o FIRESTORE_EMULATOR_HOST), o usa PAGOS_ALMACEN=memoria. ' +
          'El servicio sigue arriba (Salud lo reporta).'
      )
    );
}

conciliacion.iniciar();

// ------------------------------------------------------------ apagado ordenado
// Primero la conciliacion (que no empiece otra ronda), luego el servidor (que
// termine lo que esta atendiendo) y al final Firestore y los clientes.
apagadoOrdenado({
  log,
  tareas: [
    () => conciliacion.detener(),
    () => servidor.apagar(5000),
    () => almacen.cerrar(),
    async () => clientes.cerrar(),
  ],
});
