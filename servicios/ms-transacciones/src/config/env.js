// =============================================================================
//  Variables de entorno de ms-transacciones.
//
//  Un solo lugar las lee y las valida (cargarEnv de @goldorado/comun): el
//  resto del codigo recibe `env` ya tipado y congelado. Si una variable trae
//  basura, el proceso se cae AL ARRANCAR con un mensaje claro, no a mitad de
//  una peticion. Los valores por defecto son los de desarrollo local
//  (CONVENCIONES §6 y docker-compose.yml).
// =============================================================================

import { cargarEnv } from '@goldorado/comun';

export const ESQUEMA_ENV = Object.freeze({
  GRPC_PUERTO: { tipo: 'entero', defecto: 50054 },
  GRPC_HOST: { tipo: 'texto', defecto: '0.0.0.0' },
  // Vacio = sin token interno (desarrollo). Si tiene valor, es el mismo en los 7 procesos.
  GRPC_TOKEN_INTERNO: { tipo: 'texto', defecto: '', secreta: true },
  // Secreta porque en Atlas la cadena lleva usuario y clave.
  MONGO_URI: { tipo: 'texto', defecto: 'mongodb://localhost:27017', secreta: true },
  MONGO_DB: { tipo: 'texto', defecto: 'goldorado_transacciones' },
  // Vida de un log de sesion: lo hace cumplir el indice TTL de logs_sesion.
  LOGS_SESION_DIAS: { tipo: 'entero', defecto: 180 },
  // info | debug. Sin lista cerrada: un "DEBUG" en mayuscula no debe tumbar el
  // arranque (el logger lo lee de process.env y lo pasa a minuscula).
  LOG_NIVEL: { tipo: 'texto', defecto: 'info' },
});

export const env = cargarEnv(import.meta.url, ESQUEMA_ENV, { nombre: 'ms-transacciones' });
