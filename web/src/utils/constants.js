/**
 * Constantes globales de GolDorado.
 * Sin imports: este es el modulo raiz del que cuelga todo lo demas.
 */

export const APP_NAME = 'GolDorado';
export const APP_TAGLINE = 'Donde cada gol vale oro.';

/**
 * Claves de localStorage. Prefijadas para no chocar con otras apps del mismo host.
 *
 * Solo queda SESSION, y ahora guarda unicamente el token JWT. La clave DB
 * desaparecio junto con la base falsa: los datos viven en SQL Server.
 */
export const STORAGE_KEYS = {
  SESSION: 'goldorado:session',
};

/**
 * Cuenta sembrada por server/db/02_datos.sql. LoginPage la muestra como ayuda,
 * y solo en desarrollo.
 */
export const DEMO_CREDENTIALS = {
  username: 'demo@goldorado.co',
  password: 'Demo1234!',
};

/** Rutas reales de la app. No hay mas: nada debe enlazar fuera de esta lista. */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/registro',
  RECOVER: '/recuperar',
  DASHBOARD: '/inicio',
  AUTH_CALLBACK: '/auth/callback',
  COMPLETE_PROFILE: '/completar-perfil',
  PROFILE: '/perfil',
  WALLET: '/billetera',
  MY_BETS: '/mis-apuestas',
  PAYMENT_RESULT: '/pagos/resultado',
  ADMIN: '/admin',
};

/**
 * Clave de sessionStorage con la referencia del ultimo pago iniciado. Es el
 * respaldo de /pagos/resultado cuando el banco devuelve al usuario sin la
 * query (algunos bancos PSE la recortan).
 */
export const LAST_PAYMENT_KEY = 'goldorado:ultimoPago';

/** Foto de perfil: lo mismo que acepta el BFF. */
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Apuesta minima. El limite real lo aplica ms-apuestas; esto es la pista. */
export const MIN_BET_AMOUNT = 5000;
export const QUICK_BET_AMOUNTS = [5000, 10000, 20000, 50000];

/** Estados de un pago de Wompi tal como los devuelve ms-pagos. */
export const PAYMENT_STATUS = {
  PENDING: 'PENDIENTE',
  APPROVED: 'APROBADO',
  DECLINED: 'RECHAZADO',
  VOIDED: 'ANULADO',
  ERROR: 'ERROR',
};

/** Codigo OTP fijo del mock. Solo se revela en DEV. */
export const DEV_OTP_CODE = '482913';

/** Vigencia del token de recuperacion y limite de intentos. */
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 30;

/**
 * Tipos de documento.
 *
 * La lista de verdad esta en la tabla Tipo_Documento y RegisterForm la pide al
 * API. Esta copia es solo el valor inicial mientras llega la respuesta, para
 * que el <select> no aparezca vacio, y el respaldo que usa validateRegister.
 *
 * Los `value` tienen que coincidir con Tipo_Documento.codigo: son la llave
 * foranea de Cliente.tipo_documento. Antes esta lista ofrecia NIT y el
 * catalogo no lo tenia, asi que registrarse con esa opcion fallaba.
 */
export const DOCUMENT_TYPES = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'PA', label: 'Pasaporte' },
  { value: 'TI', label: 'Tarjeta de identidad' },
  { value: 'NIT', label: 'NIT' },
];

export const MIN_AGE = 18;

/** Estados posibles de un partido. */
export const MATCH_STATUS = {
  UPCOMING: 'upcoming',
  LIVE: 'live',
  FINISHED: 'finished',
  CANCELED: 'canceled',
};

/** Retiros (transferencia simulada). Los limites reales los aplica ms-apuestas. */
export const MIN_WITHDRAWAL_AMOUNT = 10000;
export const WITHDRAWAL_BANKS = [
  'Bancolombia',
  'Banco de Bogotá',
  'Davivienda',
  'BBVA Colombia',
  'Banco de Occidente',
  'Banco Popular',
  'Scotiabank Colpatria',
  'Banco AV Villas',
  'Nequi',
  'Daviplata',
];
export const ACCOUNT_TYPES = {
  SAVINGS: 'AHORROS',
  CHECKING: 'CORRIENTE',
};
