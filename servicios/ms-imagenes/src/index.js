/**
 * Arranque de ms-imagenes (Google Drive) · gRPC :50056
 *
 * Orden: env -> almacen (drive | local) -> servidor gRPC -> indice en memoria
 * (NO bloqueante) -> apagado ordenado.
 *
 * El servidor escucha aunque Drive no responda o las credenciales esten mal:
 * Salud lo reporta con la pista concreta, y mientras tanto BuscarImagenes
 * contesta vacio (la web cae a los escudos generados por CSS, como el
 * monolito). Un servicio que no arranca no sirve ni para diagnosticar.
 */

import {
  apagadoOrdenado,
  crearLogger,
  crearRpcSalud,
  crearServidorGrpc,
  versionDelPaquete,
} from '@goldorado/comun';
import { env } from './config/env.js';
import { modoAlmacen } from './config/requisitos.js';
import { crearAlmacen } from './almacenes/index.js';
import { crearHandlers } from './grpc/handlers.js';
import { crearServicioImagenes } from './servicios/imagenServicio.js';

const NOMBRE = 'ms-imagenes';
const log = crearLogger(NOMBRE);
const version = versionDelPaquete(import.meta.url);
const modo = modoAlmacen(env);

// ------------------------------------------------------------- dependencias
const almacen = crearAlmacen({ env, log });
const imagenes = crearServicioImagenes({ almacen, log, maxBytes: env.IMAGENES_MAX_BYTES });

const salud = crearRpcSalud({
  servicio: NOMBRE,
  motor: 'Google Drive',
  baseDatos: () => almacen.descripcion,
  modo,
  version,
  comprobar: () => almacen.comprobar(),
  plazoMs: 5000, // incluye renovar el access token de Google la primera vez
});

// --------------------------------------------------------------- servidor gRPC
const servidor = crearServidorGrpc({ nombre: NOMBRE, log, tokenInterno: env.GRPC_TOKEN_INTERNO });
servidor.registrar('imagenes', crearHandlers({ imagenes, salud }));

let puerto;
try {
  puerto = await servidor.iniciar(env.GRPC_PUERTO, env.GRPC_HOST);
} catch (error) {
  log.error(`No se pudo abrir el puerto gRPC ${env.GRPC_HOST}:${env.GRPC_PUERTO}: ${error?.message ?? error}`);
  process.exit(1);
}
log.info(`${NOMBRE} ${version} escuchando gRPC en ${env.GRPC_HOST}:${puerto} · almacen ${modo} · ${almacen.descripcion}`);

// --------------------------------------------- indice en memoria (no bloqueante)
almacen
  .iniciar()
  .then(({ imagenes: cantidad }) => log.info(`Indice de imagenes listo: ${cantidad} imagen(es) (${modo})`))
  .catch((error) =>
    log.aviso(
      `No se pudo cargar el indice de imagenes (${modo}): ${error?.message ?? error}` +
        `${error?.pista ? `. PISTA: ${error.pista}` : ''}. ` +
        'El servicio sigue arriba (Salud lo reporta) y reintenta en el proximo refresco.'
    )
  );

// ------------------------------------------------------------ apagado ordenado
apagadoOrdenado({
  log,
  tareas: [() => servidor.apagar(5000), () => almacen.cerrar()],
});
