/**
 * Variables de entorno de ms-apuestas, validadas UNA vez al arrancar.
 *
 * Si falta algo obligatorio el proceso se detiene en el segundo cero con un
 * mensaje claro (cargarEnv), en vez de fallar a la primera apuesta. Los valores
 * por defecto son los de desarrollo local (CONVENCIONES §6 y docker-compose);
 * en Azure solo cambia el .env: PG_HOST, PG_USER, PG_PASSWORD y PG_SSL=true.
 */

import { cargarEnv } from '@goldorado/comun';

export const env = cargarEnv(import.meta.url, {
  // ------------------------------------------------------------ servidor gRPC
  GRPC_PUERTO: { tipo: 'entero', defecto: 50053 },
  GRPC_HOST: { tipo: 'texto', defecto: '0.0.0.0' },
  // Vacio = sin token. Si tiene valor, debe ser el mismo en los 7 procesos.
  GRPC_TOKEN_INTERNO: { tipo: 'texto', defecto: '', secreta: true },

  // ------------------------------------------------------- servicios vecinos
  MS_DEPORTES_URL: { tipo: 'texto', defecto: 'localhost:50052' },
  MS_TRANSACCIONES_URL: { tipo: 'texto', defecto: 'localhost:50054' },

  // ----------------------------------------------------------------- PostgreSQL
  PG_HOST: { tipo: 'texto', defecto: 'localhost' },
  PG_PORT: { tipo: 'entero', defecto: 5432 },
  PG_USER: { tipo: 'texto', defecto: 'goldorado_app' },
  // Obligatoria: una conexion a Azure sin clave es un error de configuracion
  // que conviene ver al arrancar, no en la primera consulta.
  PG_PASSWORD: { tipo: 'texto', requerida: true, secreta: true },
  PG_DATABASE: { tipo: 'texto', defecto: 'goldorado_apuestas' },
  // Azure Database for PostgreSQL exige TLS: PG_SSL=true.
  PG_SSL: { tipo: 'booleano', defecto: false },
  // true = validar el certificado del servidor contra las CA del sistema.
  PG_SSL_VERIFICAR: { tipo: 'booleano', defecto: false },
  PG_POOL_MAX: { tipo: 'entero', defecto: 10 },

  // -------------------------------------------------- bandeja de salida (outbox)
  OUTBOX_INTERVALO_MS: { tipo: 'entero', defecto: 3000 },
});
