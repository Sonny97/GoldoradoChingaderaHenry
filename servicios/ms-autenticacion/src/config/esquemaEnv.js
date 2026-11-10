/**
 * Esquema de las variables de entorno de ms-autenticacion (CONVENCIONES §6).
 *
 * Vive separado de env.js a proposito: este modulo NO carga nada al
 * importarse. db/setup.js necesita solo la parte de la base y no debe exigir
 * JWT_SECRET (crear la base no firma tokens); si importara env.js, el proceso
 * se cerraria por una variable que no usa.
 */

export const ESQUEMA_BASE_DATOS = Object.freeze({
  DB_SERVER: { defecto: 'localhost' },
  DB_PORT: { tipo: 'entero', defecto: 1433 },
  DB_USER: { defecto: 'goldorado_app' },
  DB_PASSWORD: { defecto: '', secreta: true },
  DB_DATABASE: { defecto: 'GolDoradoAuth' },
  // SQLEXPRESS local no trae un certificado de confianza: sin cifrado o
  // confiando en el autofirmado. En Azure SQL: DB_ENCRYPT=true y false aqui.
  DB_ENCRYPT: { tipo: 'booleano', defecto: false },
  DB_TRUST_SERVER_CERTIFICATE: { tipo: 'booleano', defecto: true },
});

export const ESQUEMA = Object.freeze({
  GRPC_PUERTO: { tipo: 'entero', defecto: 50051 },
  GRPC_HOST: { defecto: '0.0.0.0' },
  GRPC_TOKEN_INTERNO: { defecto: '', secreta: true },

  ...ESQUEMA_BASE_DATOS,

  // Unica variable obligatoria: este es el UNICO proceso que firma y verifica.
  JWT_SECRET: { requerida: true, secreta: true },
  JWT_EXPIRES_IN: { defecto: '2h' },

  // Recuperacion de clave. No hay proveedor real de correo/SMS: en desarrollo
  // el codigo es fijo y viaja en la respuesta (codigoDev); en produccion es
  // aleatorio y no viaja.
  OTP_CODIGO_DEV: { defecto: '482913' },
  OTP_TTL_MIN: { tipo: 'entero', defecto: 10 },
  OTP_MAX_INTENTOS: { tipo: 'entero', defecto: 5 },

  // Un proveedor queda habilitado solo si tiene client id Y client secret.
  GOOGLE_CLIENT_ID: { defecto: '' },
  GOOGLE_CLIENT_SECRET: { defecto: '', secreta: true },
  MICROSOFT_CLIENT_ID: { defecto: '' },
  MICROSOFT_CLIENT_SECRET: { defecto: '', secreta: true },
  MICROSOFT_TENANT: { defecto: 'common' },

  // Auditoria best-effort (logs de sesion y eventos de seguridad, MongoDB).
  // 'apagado' = no se envia nada (vacio no sirve: cargarEnv le pone el defecto).
  MS_TRANSACCIONES_URL: { defecto: 'localhost:50054' },
});
