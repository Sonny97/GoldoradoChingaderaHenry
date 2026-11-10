/**
 * Traduccion de los errores de Google Drive a errores de negocio.
 *
 * Al usuario le llega un mensaje corto en español (el BFF lo muestra tal
 * cual); al que opera el servicio, una PISTA concreta en el log: que variable
 * revisar, que comando correr. Un 403 de Drive puede ser cinco cosas
 * distintas y adivinar cual cuesta una tarde.
 *
 *   404                                  -> NOT_FOUND
 *   401, invalid_grant, invalid_client   -> UNAVAILABLE + pista de credenciales
 *   403 storageQuotaExceeded             -> UNAVAILABLE + pista de cuota/unidad compartida
 *   403 de permisos / API deshabilitada  -> UNAVAILABLE + pista de permisos
 *   429 / 403 de limite (tras reintentos) y 5xx -> UNAVAILABLE
 *   sin respuesta (red, DNS, timeout)    -> UNAVAILABLE
 *   cualquier otra cosa                  -> se deja pasar (INTERNAL, con detalle en el log)
 */

import { ErrorNegocio, noDisponible, noEncontrado } from '@goldorado/comun';
import { estadoHttp, razonDrive } from '../utils/backoff.js';

const RAZONES_DE_CUOTA = new Set(['userRateLimitExceeded', 'rateLimitExceeded']);
const RAZONES_CREDENCIAL = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client', 'authError']);

const PISTAS = {
  oauthRechazado:
    'Google rechazo el refresh token (revocado, sin uso 6 meses, o la app sigue en "Testing" y vence a los 7 dias). ' +
    'Publica la app "En produccion", corre "node db/obtener-refresh-token.js" y actualiza DRIVE_OAUTH_REFRESH_TOKEN; ' +
    'revisa tambien DRIVE_OAUTH_CLIENT_ID / DRIVE_OAUTH_CLIENT_SECRET.',
  cuentaRechazada:
    'Google rechazo la cuenta de servicio: revisa que la llave de GOOGLE_DRIVE_CREDENCIALES no este revocada ' +
    'y que la Google Drive API este habilitada en el proyecto.',
  cuotaCuentaServicio:
    'Las cuentas de servicio NO tienen cuota en "Mi unidad" (storageQuotaExceeded): los archivos deben ir a una ' +
    'unidad compartida (DRIVE_UNIDAD_COMPARTIDA_ID) donde la cuenta sea Administrador de contenido, o usa ' +
    'DRIVE_AUTENTICACION=oauth con una cuenta @gmail.com.',
  cuotaOauth: 'La cuenta de Google se quedo sin espacio: libera espacio o vacia la papelera de Drive.',
  permisosOauth:
    'Con el scope drive.file la app solo ve los archivos que ELLA creo: DRIVE_CARPETA_RAIZ_ID debe ser la carpeta ' +
    'que imprime "npm run db:setup" (una creada a mano en la web da 404/403). Revisa que la Google Drive API este habilitada.',
  permisosCuenta:
    'Agrega el correo de la cuenta de servicio como miembro (Administrador de contenido) de la unidad compartida ' +
    'DRIVE_UNIDAD_COMPARTIDA_ID y revisa que la Google Drive API este habilitada.',
  red: 'Sin respuesta de www.googleapis.com: revisa la conexion a internet, el proxy o el firewall.',
};

/**
 * @param {unknown} error
 * @param {'oauth'|'cuenta_servicio'} autenticacion
 * @returns {Error} ErrorNegocio con .estadoHttp y .pista (o el error original)
 */
export function traducirErrorDrive(error, autenticacion) {
  if (error instanceof ErrorNegocio) return error;
  const estado = estadoHttp(error);
  const razon = razonDrive(error);
  const oauth = autenticacion === 'oauth';
  const con = (negocio, pista) => Object.assign(negocio, { estadoHttp: estado, razon, pista, causa: error });

  if (error?.code === 'CREDENCIALES') {
    return con(noDisponible('El almacén de imágenes no está disponible (credenciales de Google Drive)'), error.pista);
  }
  if (estado === 404) return con(noEncontrado('Imagen no encontrada'), '');

  const textoError = String(error?.message ?? '');
  if (estado === 401 || RAZONES_CREDENCIAL.has(razon) || /invalid_grant|invalid_client/.test(textoError)) {
    return con(
      noDisponible('El almacén de imágenes no está disponible (credenciales de Google Drive rechazadas)'),
      oauth ? PISTAS.oauthRechazado : PISTAS.cuentaRechazada
    );
  }
  if (estado === 429 || (estado === 403 && RAZONES_DE_CUOTA.has(razon))) {
    return con(noDisponible('Google Drive está limitando las peticiones; intenta de nuevo en un momento'), '');
  }
  if (estado === 403 && razon === 'storageQuotaExceeded') {
    return con(
      noDisponible('El almacén de imágenes no tiene espacio disponible'),
      oauth ? PISTAS.cuotaOauth : PISTAS.cuotaCuentaServicio
    );
  }
  if (estado === 403) {
    return con(
      noDisponible('El almacén de imágenes no está disponible (permisos de Google Drive)'),
      oauth ? PISTAS.permisosOauth : PISTAS.permisosCuenta
    );
  }
  if (estado !== null && estado >= 500) {
    return con(noDisponible('Google Drive no responde; intenta de nuevo en un momento'), '');
  }
  // Sin estado HTTP + codigo de sistema = no hubo respuesta (red, DNS, timeout).
  const codigo = String(error?.code ?? '');
  if (estado === null && (/^E[A-Z]+/.test(codigo) || /timeout|network|socket|aborted/i.test(textoError))) {
    return con(noDisponible('No hay conexión con Google Drive'), PISTAS.red);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export { PISTAS };
