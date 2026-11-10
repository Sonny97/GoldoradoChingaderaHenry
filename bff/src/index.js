/**
 * Arranque del BFF (Express, puerto 3000).
 *
 * Orden: entorno -> seis clientes gRPC -> app -> puerto -> apagado ordenado.
 *
 * El BFF arranca aunque NINGUN microservicio este arriba: los clientes gRPC se
 * conectan de forma perezosa en la primera llamada. Cada ruta que necesite un
 * servicio caido responde 503 con el nombre del servicio, y GET /api/salud
 * muestra cual esta 'caido'. Es la misma regla del monolito, que arrancaba con
 * la base apagada y lo decia en /api/salud.
 */

import { apagadoOrdenado, crearLogger } from '@goldorado/comun';

import { env } from './config/env.js';
import { cerrarClientes, crearClientes, DIRECCIONES } from './clientes.js';
import { crearApp } from './app.js';

const log = crearLogger('bff');

if (!env.COOKIE_SECRETO) {
  if (env.NODE_ENV === 'production') {
    log.error('COOKIE_SECRETO es obligatoria en produccion (firma la cookie del inicio de sesion con Google/Microsoft).');
    process.exit(1);
  }
  log.aviso('COOKIE_SECRETO vacia: se usa un secreto aleatorio (un reinicio invalida los inicios de sesion externos en curso).');
}

const clientes = crearClientes(env);
const app = crearApp({ env, clientes, log });

const servidor = app.listen(env.PORT, () => {
  const direccion = servidor.address();
  const puerto = typeof direccion === 'object' && direccion ? direccion.port : env.PORT;
  log.info(`API REST escuchando en http://localhost:${puerto}/api (${env.NODE_ENV})`);
  log.info(
    'Microservicios: ' + Object.entries(DIRECCIONES).map(([clave, variable]) => `${clave}=${env[variable]}`).join(' · ')
  );
});

servidor.on('error', (error) => {
  log.error(`No se pudo abrir el puerto ${env.PORT}: ${error?.message ?? error}`);
  process.exit(1);
});

// Primero se deja de aceptar peticiones HTTP, despues se cierran los canales gRPC.
apagadoOrdenado({
  log,
  tareas: [
    () =>
      new Promise((resolve) => {
        servidor.close(() => resolve());
        servidor.closeIdleConnections?.();
      }),
    () => cerrarClientes(clientes),
  ],
});
