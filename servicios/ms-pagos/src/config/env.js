/**
 * Variables de entorno de ms-pagos, validadas UNA vez al arrancar.
 *
 * Por defecto el servicio corre SIN nube (PAGOS_ALMACEN=memoria y
 * WOMPI_MODO=simulado) para que la app funcione de punta a punta en un portatil
 * sin Firebase ni llaves de Wompi. Los modos del tablero (firestore + sandbox o
 * produccion) solo cambian el .env; las reglas de negocio son las mismas.
 *
 * Las llaves de Wompi no son "requeridas" a nivel de cargarEnv porque en modo
 * simulado no hacen falta; index.js revisa que existan cuando el modo es real
 * y lo dice claro al arrancar (y Salud lo reporta).
 */

import { cargarEnv } from '@goldorado/comun';

export const env = cargarEnv(import.meta.url, {
  // ------------------------------------------------------------ servidor gRPC
  GRPC_PUERTO: { tipo: 'entero', defecto: 50055 },
  GRPC_HOST: { tipo: 'texto', defecto: '0.0.0.0' },
  // Vacio = sin token. Si tiene valor, debe ser el mismo en los 7 procesos.
  GRPC_TOKEN_INTERNO: { tipo: 'texto', defecto: '', secreta: true },

  // ------------------------------------------------------- servicios vecinos
  MS_APUESTAS_URL: { tipo: 'texto', defecto: 'localhost:50053' },
  MS_TRANSACCIONES_URL: { tipo: 'texto', defecto: 'localhost:50054' },

  // ------------------------------------------------------------ almacenamiento
  PAGOS_ALMACEN: { tipo: 'texto', defecto: 'memoria', valores: ['firestore', 'memoria'] },
  FIREBASE_PROJECT_ID: { tipo: 'texto', defecto: '' },
  // Ruta al JSON de la cuenta de servicio (credenciales/firebase.json). Es un secreto.
  FIREBASE_CREDENCIALES: { tipo: 'texto', defecto: '' },
  // Alternativa estandar de Google: ruta al JSON en GOOGLE_APPLICATION_CREDENTIALS.
  GOOGLE_APPLICATION_CREDENTIALS: { tipo: 'texto', defecto: '' },
  // Emulador local de Firestore (firebase emulators:start), p. ej. 127.0.0.1:8080.
  FIRESTORE_EMULATOR_HOST: { tipo: 'texto', defecto: '' },

  // ------------------------------------------------------------------- Wompi
  WOMPI_MODO: { tipo: 'texto', defecto: 'simulado', valores: ['sandbox', 'produccion', 'simulado'] },
  WOMPI_LLAVE_PUBLICA: { tipo: 'texto', defecto: '' },
  WOMPI_LLAVE_PRIVADA: { tipo: 'texto', defecto: '', secreta: true },
  WOMPI_SECRETO_EVENTOS: { tipo: 'texto', defecto: '', secreta: true },
  WOMPI_SECRETO_INTEGRIDAD: { tipo: 'texto', defecto: '', secreta: true },
  // Plazo de cada llamada HTTP a Wompi.
  WOMPI_PLAZO_MS: { tipo: 'entero', defecto: 15000 },

  // ------------------------------------------------------------------ montos
  // Wompi exige minimo $1.500; el servicio nunca baja de ahi aunque el .env lo pida.
  PAGOS_MONTO_MINIMO: { tipo: 'entero', defecto: 5000 },
  PAGOS_MONTO_MAXIMO: { tipo: 'entero', defecto: 3000000 },

  // --------------------------------------------------------------- conciliacion
  // 0 = apagada (solo para pruebas).
  CONCILIACION_INTERVALO_MS: { tipo: 'entero', defecto: 60000 },
});
