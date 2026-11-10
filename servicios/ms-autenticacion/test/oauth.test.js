/**
 * Google y Microsoft sin red: llaves RSA generadas aqui (jose), JWKS local y
 * un token endpoint falso.
 *
 * Se prueba lo que de verdad protege: aud, iss, nonce, exp, la pareja tid/iss
 * de Microsoft y el issuer de la llave firmante, y las reglas de vinculacion
 * (Google verificado vincula; Microsoft NUNCA vincula por correo).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { CODIGOS } from '@goldorado/comun';

import {
  crearProveedores,
  urlAutorizacion,
  verificarIdToken,
  TID_CUENTAS_PERSONALES,
} from '../src/servicios/proveedoresOidc.js';
import { crearServicioOAuth, MENSAJE_CORREO_REGISTRADO } from '../src/servicios/oauthServicio.js';
import { crearTokens, crearEmisorSesiones } from '../src/servicios/tokens.js';
import {
  crearReloj,
  crearAuditoriaFalsa,
  crearUsuariosFalsos,
  crearSesionesFalsas,
  filaUsuario,
} from './apoyo/falsos.js';

const AHORA = Date.parse('2026-11-09T15:00:00.000Z');
const SEG = Math.floor(AHORA / 1000);
const TID_ORG = '72f988bf-86f1-41af-91ab-2d7cd011db47';
const NONCE = 'nonce-de-prueba-123';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // ejemplo del RFC 7636

const ENV = {
  GOOGLE_CLIENT_ID: 'google-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'g-secreto',
  MICROSOFT_CLIENT_ID: '11111111-2222-3333-4444-555555555555',
  MICROSOFT_CLIENT_SECRET: 'ms-secreto',
  MICROSOFT_TENANT: 'common',
};
const proveedores = crearProveedores(ENV);

// ---- Llaves: Google, Microsoft "plantilla {tenantid}" y Microsoft cuentas personales.
const google = await generateKeyPair('RS256');
const msOrg = await generateKeyPair('RS256');
const msPersonal = await generateKeyPair('RS256');
const extraña = await generateKeyPair('RS256');

const jwksGoogle = createLocalJWKSet({
  keys: [{ ...(await exportJWK(google.publicKey)), kid: 'g1', alg: 'RS256', use: 'sig' }],
});
// Como el JWKS real de Microsoft: sin `alg` y con `issuer` en cada llave.
const jwksMicrosoft = createLocalJWKSet({
  keys: [
    { ...(await exportJWK(msOrg.publicKey)), kid: 'm-org', use: 'sig', issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' },
    {
      ...(await exportJWK(msPersonal.publicKey)),
      kid: 'm-msa',
      use: 'sig',
      issuer: `https://login.microsoftonline.com/${TID_CUENTAS_PERSONALES}/v2.0`,
    },
  ],
});
const obtenerJwks = (proveedor) => (proveedor.codigo === 'GOOGLE' ? jwksGoogle : jwksMicrosoft);

const firmar = (payload, llave, kid) => new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).sign(llave);

const claimsGoogle = (extra = {}) => ({
  iss: 'https://accounts.google.com',
  aud: ENV.GOOGLE_CLIENT_ID,
  sub: '100000000000000000099',
  iat: SEG,
  exp: SEG + 3600,
  nonce: NONCE,
  email: 'demo@goldorado.co',
  email_verified: true,
  name: 'Camilo Rojas',
  ...extra,
});

const claimsMicrosoft = (extra = {}) => ({
  iss: `https://login.microsoftonline.com/${TID_ORG}/v2.0`,
  aud: ENV.MICROSOFT_CLIENT_ID,
  sub: 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ',
  tid: TID_ORG,
  iat: SEG,
  exp: SEG + 3600,
  nonce: NONCE,
  email: 'nuevo.usuario@contoso.com',
  name: 'Nuevo Usuario Prueba',
  ...extra,
});

const tokenGoogle = (extra) => firmar(claimsGoogle(extra), google.privateKey, 'g1');
const tokenMicrosoft = (extra, { llave = msOrg.privateKey, kid = 'm-org' } = {}) =>
  firmar(claimsMicrosoft(extra), llave, kid);

const verificar = (codigo, idToken, opciones = {}) =>
  verificarIdToken(opciones.proveedor ?? proveedores[codigo], idToken, opciones.nonce ?? NONCE, {
    obtenerJwks,
    ahoraMs: AHORA,
  });

const noVerificado = (error) => error.tipoFallo === 'no_verificado';

/* ------------------------------------------------------------- URL y lista */

test('ListarProveedores: habilitado solo con client id Y secret', () => {
  const servicio = crearServicioOAuth({
    proveedores: crearProveedores({ ...ENV, MICROSOFT_CLIENT_SECRET: '' }),
    usuarios: {},
    auditoria: crearAuditoriaFalsa(),
  });
  assert.deepEqual(servicio.listarProveedores(), [
    { codigo: 'GOOGLE', nombre: 'Google', habilitado: true },
    { codigo: 'MICROSOFT', nombre: 'Microsoft', habilitado: false },
  ]);
  assert.throws(
    () =>
      servicio.urlAutorizacionExterna({
        proveedor: 'MICROSOFT',
        redirectUri: 'http://localhost:3003/api/auth/oauth/microsoft/callback',
        state: 's',
        nonce: 'n',
        codeChallenge: CHALLENGE,
      }),
    (e) =>
      e.codigo === CODIGOS.FAILED_PRECONDITION && e.message === 'El inicio de sesión con Microsoft no está configurado'
  );
});

test('URL de autorizacion: OIDC + PKCE S256 completos en ambos proveedores', () => {
  const datos = { state: 'estado-1', nonce: NONCE, codeChallenge: CHALLENGE };
  const esperado = (redirectUri, clientId) => ({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state: 'estado-1',
    nonce: NONCE,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  const redirectGoogle = 'http://localhost:3003/api/auth/oauth/google/callback';
  const g = new URL(urlAutorizacion(proveedores.GOOGLE, { ...datos, redirectUri: redirectGoogle }));
  assert.equal(`${g.origin}${g.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(Object.fromEntries(g.searchParams), esperado(redirectGoogle, ENV.GOOGLE_CLIENT_ID));

  const redirectMs = 'http://localhost:3003/api/auth/oauth/microsoft/callback';
  const m = new URL(urlAutorizacion(proveedores.MICROSOFT, { ...datos, redirectUri: redirectMs }));
  assert.equal(`${m.origin}${m.pathname}`, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.deepEqual(Object.fromEntries(m.searchParams), esperado(redirectMs, ENV.MICROSOFT_CLIENT_ID));

  const personales = crearProveedores({ ...ENV, MICROSOFT_TENANT: 'consumers' }).MICROSOFT;
  assert.match(urlAutorizacion(personales, { ...datos, redirectUri: redirectMs }), /\/consumers\/oauth2\/v2\.0\/authorize\?/);

  const servicio = crearServicioOAuth({ proveedores, usuarios: {}, auditoria: crearAuditoriaFalsa() });
  assert.throws(
    () => servicio.urlAutorizacionExterna({ proveedor: 'google', redirectUri: redirectGoogle, state: 's', nonce: 'n', codeChallenge: 'corto' }),
    (e) => e.codigo === CODIGOS.INVALID_ARGUMENT
  );
  assert.throws(() => servicio.urlAutorizacionExterna({ proveedor: 'FACEBOOK' }), (e) => e.codigo === CODIGOS.INVALID_ARGUMENT);
});

/* -------------------------------------------------------- id_token: Google */

test('id_token de Google: valido con cualquiera de sus dos iss', async () => {
  const identidad = await verificar('GOOGLE', await tokenGoogle());
  assert.deepEqual(identidad, {
    proveedor: 'GOOGLE',
    inquilino: '',
    sujeto: '100000000000000000099',
    email: 'demo@goldorado.co',
    emailVerificado: true,
    nombre: 'Camilo Rojas',
  });
  const sinEsquema = await verificar('GOOGLE', await tokenGoogle({ iss: 'accounts.google.com' }));
  assert.equal(sinEsquema.sujeto, '100000000000000000099');
});

test('id_token de Google: aud, iss, nonce, exp y llave ajena se rechazan', async () => {
  await assert.rejects(verificar('GOOGLE', await tokenGoogle({ aud: 'otra-app' })), noVerificado);
  await assert.rejects(verificar('GOOGLE', await tokenGoogle({ iss: 'https://accounts.evil.com' })), noVerificado);
  await assert.rejects(verificar('GOOGLE', await tokenGoogle({ nonce: 'otro' })), noVerificado);
  await assert.rejects(verificar('GOOGLE', await tokenGoogle({ nonce: undefined })), noVerificado);
  await assert.rejects(verificar('GOOGLE', await tokenGoogle({ iat: SEG - 7200, exp: SEG - 3600 })), noVerificado);
  await assert.rejects(verificar('GOOGLE', await firmar(claimsGoogle(), extraña.privateKey, 'g1')), noVerificado);
  await assert.rejects(verificar('GOOGLE', 'no.es.jwt'), noVerificado);
});

/* ----------------------------------------------------- id_token: Microsoft */

test('id_token de Microsoft: tenant de organizacion y cuenta personal validos', async () => {
  const org = await verificar('MICROSOFT', await tokenMicrosoft());
  assert.equal(org.inquilino, TID_ORG);
  assert.equal(org.sujeto, 'AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ');
  assert.equal(org.emailVerificado, false, 'el correo de Microsoft nunca cuenta como verificado');

  const personal = await verificar(
    'MICROSOFT',
    await tokenMicrosoft(
      { tid: TID_CUENTAS_PERSONALES, iss: `https://login.microsoftonline.com/${TID_CUENTAS_PERSONALES}/v2.0`, email: undefined, preferred_username: 'Vale@Hotmail.com' },
      { llave: msPersonal.privateKey, kid: 'm-msa' }
    )
  );
  assert.equal(personal.inquilino, TID_CUENTAS_PERSONALES);
  assert.equal(personal.email, 'vale@hotmail.com', 'preferred_username como respaldo, normalizado');
});

test('id_token de Microsoft: tid/iss, issuer de la llave, aud, nonce y exp', async () => {
  // iss de OTRO tenant con el tid de este.
  const otroTenant = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  await assert.rejects(
    verificar('MICROSOFT', await tokenMicrosoft({ iss: `https://login.microsoftonline.com/${otroTenant}/v2.0` })),
    noVerificado
  );
  // tid que no es GUID.
  await assert.rejects(
    verificar('MICROSOFT', await tokenMicrosoft({ tid: 'contoso', iss: 'https://login.microsoftonline.com/contoso/v2.0' })),
    noVerificado
  );
  // Llave de cuentas PERSONALES firmando un token de organizacion: la firma es
  // valida, pero esa llave no habla por ese tenant.
  await assert.rejects(
    verificar('MICROSOFT', await tokenMicrosoft({}, { llave: msPersonal.privateKey, kid: 'm-msa' })),
    noVerificado
  );
  await assert.rejects(verificar('MICROSOFT', await tokenMicrosoft({ aud: ENV.GOOGLE_CLIENT_ID })), noVerificado);
  await assert.rejects(verificar('MICROSOFT', await tokenMicrosoft({ nonce: 'otro' })), noVerificado);
  await assert.rejects(verificar('MICROSOFT', await tokenMicrosoft({ exp: SEG - 1 })), noVerificado);

  // Con MICROSOFT_TENANT=consumers, un tenant de organizacion no entra.
  const soloPersonales = crearProveedores({ ...ENV, MICROSOFT_TENANT: 'consumers' }).MICROSOFT;
  await assert.rejects(verificar('MICROSOFT', await tokenMicrosoft(), { proveedor: soloPersonales }), noVerificado);
});

/* ------------------------------------------------------- flujo y vinculacion */

/** Token endpoint falso: anota el POST y responde lo que la prueba diga. */
function endpointFalso(respuesta) {
  const llamadas = [];
  const fetchFalso = async (url, init) => {
    llamadas.push({ url, campos: Object.fromEntries(init.body) });
    if (respuesta instanceof Error) throw respuesta;
    const { status = 200, cuerpo } = await respuesta();
    return { ok: status < 400, status, json: async () => cuerpo };
  };
  return { fetchFalso, llamadas };
}

function armarFlujo(respuesta) {
  const reloj = crearReloj('2026-11-09T15:00:00.000Z');
  const usuarios = crearUsuariosFalsos([
    filaUsuario({ password_hash: '$2a$04$x' }),
    filaUsuario({ id_usuario: '2', email: 'valentina.mesa@hotmail.com', numero_documento: '1098765432', password_hash: '$2a$04$y' }),
  ]);
  const sesiones = crearSesionesFalsas(usuarios);
  const auditoria = crearAuditoriaFalsa();
  const tokens = crearTokens({ secreto: 'z'.repeat(40), duracion: '2h', reloj });
  const { fetchFalso, llamadas } = endpointFalso(respuesta);
  const servicio = crearServicioOAuth({
    proveedores,
    usuarios,
    emitirSesion: crearEmisorSesiones({ tokens, sesiones }),
    auditoria,
    log: { aviso() {}, info() {}, error() {}, debug() {} },
    reloj,
    fetch: fetchFalso,
    obtenerJwks,
  });
  return { servicio, usuarios, sesiones, auditoria, llamadas };
}

const callback = (proveedor, extra = {}) => ({
  proveedor,
  code: 'code-123',
  codeVerifier: 'v'.repeat(43),
  redirectUri: `http://localhost:3003/api/auth/oauth/${proveedor.toLowerCase()}/callback`,
  nonce: NONCE,
  contexto: { ip: '181.49.3.120', userAgent: 'Android' },
  ...extra,
});

test('Google con correo verificado VINCULA la cuenta existente', async () => {
  const idToken = await tokenGoogle();
  const { servicio, usuarios, sesiones, auditoria, llamadas } = armarFlujo(async () => ({ cuerpo: { id_token: idToken } }));

  const respuesta = await servicio.iniciarSesionExterna(callback('GOOGLE'));
  assert.equal(respuesta.usuario.id, 1);
  assert.equal(respuesta.esNuevo, false);
  assert.deepEqual(respuesta.usuario.proveedores, ['GOOGLE']);
  assert.equal(usuarios.cuentas[0].sujeto, '100000000000000000099');

  // El cambio del code lleva secret, verifier y la MISMA redirect_uri.
  assert.equal(llamadas[0].url, 'https://oauth2.googleapis.com/token');
  assert.deepEqual(llamadas[0].campos, {
    grant_type: 'authorization_code',
    code: 'code-123',
    redirect_uri: 'http://localhost:3003/api/auth/oauth/google/callback',
    client_id: ENV.GOOGLE_CLIENT_ID,
    client_secret: 'g-secreto',
    code_verifier: 'v'.repeat(43),
  });

  // Sesion propia (no el token de Google) con el proveedor anotado.
  const { jti } = jwt.decode(respuesta.token);
  assert.equal(sesiones.filas.get(jti).proveedor, 'GOOGLE');
  assert.equal(auditoria.eventos[0].tipo, 'CUENTA_EXTERNA_VINCULADA');
  assert.deepEqual(
    { exitoso: auditoria.intentos.at(-1).exitoso, proveedor: auditoria.intentos.at(-1).proveedor },
    { exitoso: true, proveedor: 'GOOGLE' }
  );
});

test('Google SIN correo verificado no vincula: ALREADY_EXISTS', async () => {
  const idToken = await tokenGoogle({ email_verified: false });
  const { servicio, usuarios } = armarFlujo(async () => ({ cuerpo: { id_token: idToken } }));
  await assert.rejects(
    servicio.iniciarSesionExterna(callback('GOOGLE')),
    (e) => e.codigo === CODIGOS.ALREADY_EXISTS && e.message === MENSAJE_CORREO_REGISTRADO
  );
  assert.equal(usuarios.cuentas.length, 0);
});

test('Microsoft con el correo de una cuenta existente NUNCA vincula (nOAuth)', async () => {
  const idToken = await tokenMicrosoft({ email: 'valentina.mesa@hotmail.com' });
  const { servicio, usuarios, sesiones, auditoria } = armarFlujo(async () => ({ cuerpo: { id_token: idToken } }));
  await assert.rejects(
    servicio.iniciarSesionExterna(callback('MICROSOFT')),
    (e) => e.codigo === CODIGOS.ALREADY_EXISTS && e.message === MENSAJE_CORREO_REGISTRADO
  );
  assert.equal(usuarios.cuentas.length, 0);
  assert.equal(sesiones.filas.size, 0);
  assert.equal(auditoria.intentos.at(-1).exitoso, false);
  assert.equal(auditoria.intentos.at(-1).proveedor, 'MICROSOFT');
});

test('Microsoft con correo nuevo crea usuario SIN clave y perfil INCOMPLETO; luego lo reconoce por (tid, sub)', async () => {
  let idToken = await tokenMicrosoft();
  const { servicio, usuarios, llamadas } = armarFlujo(async () => ({ cuerpo: { id_token: idToken } }));

  const primera = await servicio.iniciarSesionExterna(callback('MICROSOFT'));
  assert.equal(primera.esNuevo, true);
  assert.equal(primera.usuario.perfilCompleto, false);
  assert.equal(primera.usuario.tienePassword, false);
  assert.equal(primera.usuario.rol, 'cliente');
  assert.equal(primera.usuario.nombres, 'Nuevo');
  assert.equal(primera.usuario.apellidos, 'Usuario Prueba');
  assert.deepEqual(primera.usuario.proveedores, ['MICROSOFT']);
  assert.equal(usuarios.cuentas[0].inquilino, TID_ORG);
  assert.equal(llamadas[0].url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
  assert.equal(llamadas[0].campos.scope, 'openid email profile');

  // Segundo login: el correo cambio en Microsoft, pero la identidad es (tid, sub).
  idToken = await tokenMicrosoft({ email: 'otro.correo@contoso.com' });
  const segunda = await servicio.iniciarSesionExterna(callback('MICROSOFT'));
  assert.equal(segunda.esNuevo, false);
  assert.equal(segunda.usuario.id, primera.usuario.id);
});

test('fallas del proveedor: red/5xx -> UNAVAILABLE; 4xx o nonce malo -> UNAUTHENTICATED', async () => {
  const caido = armarFlujo(new TypeError('fetch failed'));
  await assert.rejects(
    caido.servicio.iniciarSesionExterna(callback('GOOGLE')),
    (e) => e.codigo === CODIGOS.UNAVAILABLE && e.message === 'No pudimos comunicarnos con Google'
  );
  assert.equal(caido.auditoria.intentos.at(-1).motivoFallo, 'Proveedor no disponible');

  const error500 = armarFlujo(async () => ({ status: 503, cuerpo: {} }));
  await assert.rejects(error500.servicio.iniciarSesionExterna(callback('MICROSOFT')), (e) => e.codigo === CODIGOS.UNAVAILABLE);

  const codeVencido = armarFlujo(async () => ({ status: 400, cuerpo: { error: 'invalid_grant' } }));
  await assert.rejects(
    codeVencido.servicio.iniciarSesionExterna(callback('GOOGLE')),
    (e) => e.codigo === CODIGOS.UNAUTHENTICATED && e.message === 'No pudimos verificar tu cuenta de Google'
  );

  const idToken = await tokenMicrosoft({ nonce: 'de-otro-intento' });
  const nonceMalo = armarFlujo(async () => ({ cuerpo: { id_token: idToken } }));
  await assert.rejects(
    nonceMalo.servicio.iniciarSesionExterna(callback('MICROSOFT')),
    (e) => e.codigo === CODIGOS.UNAUTHENTICATED && e.message === 'No pudimos verificar tu cuenta de Microsoft'
  );
});

test('cuenta vinculada pero inactiva -> PERMISSION_DENIED', async () => {
  const idToken = await tokenGoogle();
  const { servicio, usuarios, sesiones } = armarFlujo(async () => ({ cuerpo: { id_token: idToken } }));
  usuarios.tabla.get(1).activo = false;
  await assert.rejects(
    servicio.iniciarSesionExterna(callback('GOOGLE')),
    (e) => e.codigo === CODIGOS.PERMISSION_DENIED && e.message === 'Tu cuenta está inactiva. Comunícate con soporte.'
  );
  assert.equal(sesiones.filas.size, 0);
});
