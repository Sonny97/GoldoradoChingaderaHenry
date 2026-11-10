/**
 * Cliente de la API de Drive v3 segun DRIVE_AUTENTICACION.
 *
 *   oauth            cuenta @gmail.com: OAuth2 con refresh token, scope
 *                    drive.file (la app solo ve lo que ella crea). El access
 *                    token se renueva solo con el refresh token.
 *   cuenta_servicio  Workspace: llave JSON + JWT, scope drive, archivos en una
 *                    UNIDAD COMPARTIDA (una cuenta de servicio no tiene cuota
 *                    propia desde 2025: storageQuotaExceeded).
 *
 * Se usa el export `auth` de @googleapis/drive (es google-auth-library) para
 * no agregar otra dependencia directa. Se usa el constructor JWT y no
 * GoogleAuth({ keyFile }) porque esa opcion esta deprecada e imprime un aviso.
 */

import { readFile } from 'node:fs/promises';
import { auth, drive as driveApi } from '@googleapis/drive';

import { SCOPE_DRIVE } from '../config/requisitos.js';

/** Error de configuracion local (antes de hablar con Google). */
function errorCredenciales(mensaje, pista) {
  return Object.assign(new Error(mensaje), { code: 'CREDENCIALES', pista });
}

/**
 * @param {object} o
 * @param {'oauth'|'cuenta_servicio'} o.autenticacion
 * @param {string} [o.clientId] @param {string} [o.clientSecret] @param {string} [o.refreshToken]
 * @param {string} [o.rutaCredenciales]  ruta ABSOLUTA a la llave JSON
 */
export async function crearClienteDrive({ autenticacion, clientId, clientSecret, refreshToken, rutaCredenciales }) {
  if (autenticacion === 'oauth') {
    const cliente = new auth.OAuth2({ clientId, clientSecret });
    cliente.setCredentials({ refresh_token: refreshToken });
    return driveApi({ version: 'v3', auth: cliente, timeout: 30_000 });
  }

  let llave;
  try {
    llave = JSON.parse(await readFile(rutaCredenciales, 'utf8'));
  } catch (error) {
    throw errorCredenciales(
      `No se pudo leer la llave de la cuenta de servicio (${rutaCredenciales}): ${error?.code ?? error?.message}`,
      'Descarga la llave JSON de la cuenta de servicio y apunta GOOGLE_DRIVE_CREDENCIALES a ella (carpeta credenciales/, ignorada por git).'
    );
  }
  if (!llave?.client_email || !llave?.private_key) {
    throw errorCredenciales(
      `La llave ${rutaCredenciales} no es de una cuenta de servicio (faltan client_email / private_key)`,
      'Descarga una llave de tipo "Cuenta de servicio" (JSON) en Google Cloud > IAM > Cuentas de servicio > Claves.'
    );
  }
  const jwt = new auth.JWT({ email: llave.client_email, key: llave.private_key, scopes: [SCOPE_DRIVE] });
  return driveApi({ version: 'v3', auth: jwt, timeout: 30_000 });
}
