/**
 * Obtiene UNA vez el DRIVE_OAUTH_REFRESH_TOKEN (opcion A: cuenta @gmail.com).
 *
 *   $env:DRIVE_OAUTH_CLIENT_ID="..."; $env:DRIVE_OAUTH_CLIENT_SECRET="..."
 *   node db/obtener-refresh-token.js
 *
 * (tambien los toma del .env del servicio). Levanta un servidor en
 * http://localhost:53682, imprime la URL de consentimiento de Google y, cuando
 * Google redirige a /oauth2callback, cambia el codigo por los tokens con PKCE
 * (code_verifier S256) + client_secret, y verifica el `state` contra CSRF.
 *
 * Requisitos en Google Cloud (docs/GOOGLE-MICROSOFT-DRIVE.md §4):
 *   - cliente OAuth tipo "Aplicacion web" con la redireccion
 *     http://localhost:53682/oauth2callback
 *   - scope https://www.googleapis.com/auth/drive.file en la pantalla de consentimiento
 *   - app PUBLICADA ("En produccion"): en "Testing" el refresh token vence a los 7 dias.
 */

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { cargarEnv } from '@goldorado/comun';
import { auth } from '@googleapis/drive';

import { SCOPE_DRIVE_FILE } from '../src/config/requisitos.js';

// Solo las dos variables que hacen falta (del entorno o del .env del servicio).
const { DRIVE_OAUTH_CLIENT_ID: clientId, DRIVE_OAUTH_CLIENT_SECRET: clientSecret } = cargarEnv(
  import.meta.url,
  {
    DRIVE_OAUTH_CLIENT_ID: { tipo: 'texto', requerida: true },
    DRIVE_OAUTH_CLIENT_SECRET: { tipo: 'texto', requerida: true, secreta: true },
  },
  { nombre: 'obtener-refresh-token' }
);

const PUERTO = 53682;
const REDIRECCION = `http://localhost:${PUERTO}/oauth2callback`;
const PLAZO_MS = 5 * 60 * 1000;

const cliente = new auth.OAuth2({ clientId, clientSecret, redirectUri: REDIRECCION });
const { codeVerifier, codeChallenge } = await cliente.generateCodeVerifierAsync();
const estado = randomBytes(16).toString('hex');

const urlConsentimiento = cliente.generateAuthUrl({
  access_type: 'offline', // sin esto Google no entrega refresh token
  prompt: 'consent', // fuerza el refresh token aunque ya se hubiera autorizado antes
  scope: [SCOPE_DRIVE_FILE],
  code_challenge_method: 'S256',
  code_challenge: codeChallenge,
  state: estado,
});

function responder(res, codigo, texto) {
  res.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(texto);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', REDIRECCION);
  if (url.pathname !== '/oauth2callback') return responder(res, 404, 'No encontrado');

  if (url.searchParams.get('error')) {
    responder(res, 400, `Google respondio: ${url.searchParams.get('error')}. Puedes cerrar esta pestaña.`);
    console.error(`Consentimiento rechazado: ${url.searchParams.get('error')}`);
    return terminar(1);
  }
  if (url.searchParams.get('state') !== estado) return responder(res, 400, 'state invalido (posible CSRF): se ignora.');

  try {
    const { tokens } = await cliente.getToken({ code: url.searchParams.get('code') ?? '', codeVerifier });
    if (!tokens.refresh_token) {
      responder(res, 500, 'Google no entrego refresh token. Mira la consola.');
      console.error(
        'Google no devolvio refresh_token. Quita el acceso de la app en https://myaccount.google.com/permissions y vuelve a correr el script.'
      );
      return terminar(1);
    }
    responder(res, 200, 'Listo: copia el DRIVE_OAUTH_REFRESH_TOKEN de la consola. Puedes cerrar esta pestaña.');
    console.log('\nAgrega esta linea a servicios/ms-imagenes/.env:\n');
    console.log(`DRIVE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log(`(scope concedido: ${tokens.scope ?? 'desconocido'})`);
    return terminar(0);
  } catch (error) {
    responder(res, 500, 'No se pudo cambiar el codigo por tokens. Mira la consola.');
    console.error(`Error al pedir los tokens: ${error?.response?.data?.error_description ?? error?.message ?? error}`);
    return terminar(1);
  }
});

function terminar(codigo) {
  servidor.close();
  setImmediate(() => process.exit(codigo));
}

servidor.on('error', (error) => {
  console.error(`No se pudo abrir ${REDIRECCION}: ${error.message}`);
  process.exit(1);
});

servidor.listen(PUERTO, 'localhost', () => {
  console.log('1. Abre esta URL en el navegador e inicia sesion con la cuenta de Google dueña de las imagenes:\n');
  console.log(urlConsentimiento);
  console.log(`\n2. Esperando la redireccion en ${REDIRECCION} (maximo 5 minutos)...`);
});

setTimeout(() => {
  console.error('Se acabo el tiempo sin recibir la redireccion de Google.');
  terminar(1);
}, PLAZO_MS).unref();
