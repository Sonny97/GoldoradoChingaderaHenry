/**
 * Requisitos de configuracion que dependen de OTRA variable (cargarEnv no los
 * puede expresar): en modo drive, cada forma de autenticarse exige lo suyo.
 *
 * Funcion pura, separada de env.js para poder probarla sin cargar el .env.
 */

export const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive';
export const SCOPE_DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';

/** 'local' | 'drive/oauth' | 'drive/cuenta_servicio' (lo que muestra Salud). */
export function modoAlmacen(env) {
  return env.IMAGENES_ALMACEN === 'drive' ? `drive/${env.DRIVE_AUTENTICACION}` : 'local';
}

/** @returns {string[]} mensajes de lo que falta (vacio = todo bien) */
export function requisitosDrive(env) {
  if (env.IMAGENES_ALMACEN !== 'drive') return [];
  const faltan = [];
  const vacia = (clave) => !String(env[clave] ?? '').trim();

  if (env.DRIVE_AUTENTICACION === 'oauth') {
    for (const clave of ['DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET', 'DRIVE_OAUTH_REFRESH_TOKEN']) {
      if (vacia(clave)) faltan.push(`${clave} es obligatoria con DRIVE_AUTENTICACION=oauth`);
    }
    if (vacia('DRIVE_OAUTH_REFRESH_TOKEN') === true && !vacia('DRIVE_OAUTH_CLIENT_ID')) {
      faltan.push('Obten el refresh token con: node db/obtener-refresh-token.js');
    }
  } else {
    if (vacia('GOOGLE_DRIVE_CREDENCIALES')) {
      faltan.push('GOOGLE_DRIVE_CREDENCIALES (ruta a la llave JSON) es obligatoria con DRIVE_AUTENTICACION=cuenta_servicio');
    }
    // Sin unidad compartida, una cuenta de servicio no tiene cuota: toda subida
    // fallaria con storageQuotaExceeded. Mejor decirlo al arrancar.
    if (vacia('DRIVE_UNIDAD_COMPARTIDA_ID')) {
      faltan.push(
        'DRIVE_UNIDAD_COMPARTIDA_ID es obligatoria con cuenta_servicio: las cuentas de servicio no tienen cuota ' +
          'en "Mi unidad" (storageQuotaExceeded). Usa una unidad compartida o DRIVE_AUTENTICACION=oauth'
      );
    }
  }
  return faltan;
}
