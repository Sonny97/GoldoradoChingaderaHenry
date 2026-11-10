/**
 * OpenID Connect con Google y Microsoft: URL de autorizacion, cambio del
 * `code` por tokens y validacion del id_token. Todo del lado del servidor
 * (Authorization Code + PKCE, cliente confidencial).
 *
 * El BFF genera state, nonce y code_verifier y los guarda en su cookie
 * firmada; aqui solo llegan el code_challenge (para la URL) y luego el code, el
 * verifier y el nonce (para el callback). El client_secret no sale de este
 * proceso.
 *
 * Validacion del id_token (docs oficiales, ver docs de OAuth del proyecto):
 *   Google:    firma JWKS, iss en sus DOS valores validos, aud, exp, nonce.
 *   Microsoft: firma JWKS, aud, exp, tid GUID, iss === .../{tid}/v2.0, el
 *              issuer de la LLAVE firmante (con {tenantid} reemplazado) === iss,
 *              y nonce. Con el tenant 'common' cualquier directorio puede
 *              emitir tokens; sin estas dos comprobaciones de issuer, una llave
 *              de cuentas personales podria "hablar" por un tenant empresarial.
 *
 * fetch y el JWKS se inyectan: las pruebas usan un endpoint falso y
 * createLocalJWKSet con llaves generadas en la prueba.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

/** tid fijo de las cuentas PERSONALES de Microsoft (Outlook, Hotmail, Xbox). */
export const TID_CUENTAS_PERSONALES = '9188040d-6c67-4c5b-b112-36a304b66dad';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMISORES_GOOGLE = ['https://accounts.google.com', 'accounts.google.com'];
const ALCANCE = 'openid email profile';
const PLAZO_HTTP_MS = 8000;

/** Configuracion de los dos proveedores a partir del env. */
export function crearProveedores(env) {
  const tenant = String(env.MICROSOFT_TENANT || 'common').trim();
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
  return Object.freeze({
    GOOGLE: Object.freeze({
      codigo: 'GOOGLE',
      nombre: 'Google',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Habilitado SOLO con los dos: sin secret, el cambio del code fallaria
      // en el callback, cuando el usuario ya eligio su cuenta.
      habilitado: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      urlAutorizacion: 'https://accounts.google.com/o/oauth2/v2/auth',
      urlToken: 'https://oauth2.googleapis.com/token',
      urlJwks: 'https://www.googleapis.com/oauth2/v3/certs',
    }),
    MICROSOFT: Object.freeze({
      codigo: 'MICROSOFT',
      nombre: 'Microsoft',
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenant,
      // Una app "Web" de Entra es cliente confidencial: sin secret responde
      // AADSTS7000218 aunque se use PKCE.
      habilitado: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
      urlAutorizacion: `${base}/oauth2/v2.0/authorize`,
      urlToken: `${base}/oauth2/v2.0/token`,
      urlJwks: `${base}/discovery/v2.0/keys`,
    }),
  });
}

/**
 * Error de proveedor con su categoria:
 *   'no_disponible' -> no pudimos hablar con el proveedor (red, 5xx, JWKS caido)
 *   'no_verificado' -> hablamos, pero lo que dijo no prueba quien es la persona
 */
export function falloProveedor(tipo, causa) {
  const error = new Error(causa?.message ?? tipo, { cause: causa });
  error.tipoFallo = tipo;
  return error;
}

/** Errores de jose / fetch que significan "no hubo respuesta util", no "token malo". */
function esFalloDeRed(error) {
  return (
    ['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC'].includes(error?.code) ||
    ['TypeError', 'AbortError', 'TimeoutError'].includes(error?.name)
  );
}

/** URL a la que el BFF redirige el navegador (OIDC + PKCE S256). */
export function urlAutorizacion(proveedor, { redirectUri, state, nonce, codeChallenge }) {
  const url = new URL(proveedor.urlAutorizacion);
  url.search = new URLSearchParams({
    client_id: proveedor.clientId,
    response_type: 'code',
    scope: ALCANCE,
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: codeChallenge,
    // Sin esto el proveedor asume 'plain' y el challenge seria el verifier en claro.
    code_challenge_method: 'S256',
    // Deja elegir cuenta aunque haya una sesion abierta en el navegador.
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/**
 * Cambia el `code` por tokens (POST form-urlencoded). redirect_uri tiene que
 * ser EXACTAMENTE la de la autorizacion y code_verifier la pareja del
 * code_challenge: es lo que impide que un `code` robado sirva a otro.
 */
export async function intercambiarCodigo(proveedor, { code, codeVerifier, redirectUri }, fetchImpl = fetch) {
  const campos = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: proveedor.clientId,
    client_secret: proveedor.clientSecret,
    code_verifier: codeVerifier,
  };
  if (proveedor.codigo === 'MICROSOFT') campos.scope = ALCANCE;

  let respuesta;
  try {
    respuesta = await fetchImpl(proveedor.urlToken, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(campos),
      signal: AbortSignal.timeout(PLAZO_HTTP_MS),
    });
  } catch (error) {
    throw falloProveedor('no_disponible', error);
  }

  let cuerpo = {};
  try {
    cuerpo = await respuesta.json();
  } catch {
    // Un 502 con HTML de un proxy no trae JSON: el estado HTTP basta.
  }

  if (!respuesta.ok) {
    // 4xx = code vencido o ya usado, redirect_uri o verifier distintos: no es
    // una caida, es un intento que no prueba nada.
    const tipo = respuesta.status >= 500 ? 'no_disponible' : 'no_verificado';
    throw falloProveedor(
      tipo,
      new Error(`token endpoint ${respuesta.status}: ${cuerpo.error ?? ''} ${cuerpo.error_description ?? ''}`.trim())
    );
  }
  if (typeof cuerpo.id_token !== 'string') {
    throw falloProveedor('no_verificado', new Error('La respuesta del token endpoint no trae id_token'));
  }
  return cuerpo.id_token;
}

/** JWKS remoto, uno por URL y para todo el proceso (jose cachea las llaves). */
const jwksEnCache = new Map();
export function jwksRemoto(proveedor) {
  if (!jwksEnCache.has(proveedor.urlJwks)) {
    jwksEnCache.set(proveedor.urlJwks, createRemoteJWKSet(new URL(proveedor.urlJwks)));
  }
  return jwksEnCache.get(proveedor.urlJwks);
}

/** Algoritmo oficial de Microsoft para multi-tenant (ver cabecera). */
function validarEmisorMicrosoft(proveedor, payload, cabecera, jwks) {
  const { tid } = payload;
  if (typeof tid !== 'string' || !GUID.test(tid)) throw new Error('tid ausente o no es un GUID');

  if (payload.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
    throw new Error('iss no corresponde al tid del token');
  }

  const llave = jwks.jwks?.()?.keys?.find((k) => k.kid === cabecera.kid);
  const emisorLlave = typeof llave?.issuer === 'string' ? llave.issuer.replace(/\{tenantid\}/i, tid) : null;
  if (emisorLlave !== payload.iss) throw new Error('el issuer de la llave firmante no coincide con iss');

  // El tenant configurado tambien limita QUIEN puede entrar.
  const tenant = proveedor.tenant.toLowerCase();
  if (GUID.test(tenant) && tid.toLowerCase() !== tenant) throw new Error('tenant no permitido');
  if (tenant === 'consumers' && tid !== TID_CUENTAS_PERSONALES) throw new Error('solo cuentas personales');
  if (tenant === 'organizations' && tid === TID_CUENTAS_PERSONALES) throw new Error('solo cuentas de organizacion');
}

const correoNormalizado = (valor) =>
  typeof valor === 'string' && valor.includes('@') ? valor.trim().toLowerCase() : null;

/**
 * Valida el id_token y devuelve la IDENTIDAD externa normalizada:
 *   { proveedor, inquilino, sujeto, email, emailVerificado, nombre }
 */
export async function verificarIdToken(proveedor, idToken, nonce, { obtenerJwks = jwksRemoto, ahoraMs = Date.now() } = {}) {
  const jwks = obtenerJwks(proveedor);
  const esGoogle = proveedor.codigo === 'GOOGLE';

  let resultado;
  try {
    resultado = await jwtVerify(idToken, jwks, {
      audience: proveedor.clientId,
      algorithms: ['RS256'],
      currentDate: new Date(ahoraMs),
      // Microsoft no tiene UN issuer con 'common': se valida a mano despues.
      ...(esGoogle ? { issuer: EMISORES_GOOGLE } : {}),
      requiredClaims: esGoogle ? ['sub', 'iat', 'exp'] : ['iss', 'tid', 'sub', 'iat', 'exp'],
    });
  } catch (error) {
    throw falloProveedor(esFalloDeRed(error) ? 'no_disponible' : 'no_verificado', error);
  }

  const { payload, protectedHeader } = resultado;
  try {
    if (!esGoogle) validarEmisorMicrosoft(proveedor, payload, protectedHeader, jwks);
    // El nonce ata el id_token a ESTE intento de login: sin el, un id_token
    // capturado en otro momento podria reutilizarse.
    if (typeof payload.nonce !== 'string' || !nonce || payload.nonce !== nonce) {
      throw new Error('nonce no coincide');
    }
  } catch (error) {
    throw falloProveedor('no_verificado', error);
  }

  if (esGoogle) {
    return {
      proveedor: 'GOOGLE',
      inquilino: '',
      sujeto: String(payload.sub),
      email: correoNormalizado(payload.email),
      // Estrictamente true: es lo unico que autoriza vincular por correo.
      emailVerificado: payload.email_verified === true,
      nombre: payload.name ?? ([payload.given_name, payload.family_name].filter(Boolean).join(' ') || null),
    };
  }

  return {
    proveedor: 'MICROSOFT',
    inquilino: payload.tid.toLowerCase(),
    sujeto: String(payload.sub),
    // preferred_username solo como respaldo para mostrar: puede ser un telefono.
    email: correoNormalizado(payload.email) ?? correoNormalizado(payload.preferred_username),
    // Microsoft NO garantiza que el correo sea de quien inicia sesion.
    emailVerificado: false,
    nombre: payload.name ?? null,
  };
}
