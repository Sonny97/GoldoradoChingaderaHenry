/**
 * Aplicacion Express del BFF: middlewares, rutas y manejo de errores.
 *
 * Igual que en el monolito, se separa de index.js a proposito: index.js abre el
 * puerto y crea los clientes gRPC; este modulo solo construye la app con lo que
 * le pasen. Las pruebas le inyectan clientes que apuntan a servidores gRPC
 * falsos y un `env` propio, sin .env ni microservicios de verdad.
 *
 *   crearApp({ env, clientes, log })
 *     env       PORT, CORS_ORIGIN, WEB_URL, URL_PUBLICA_API, COOKIE_SECRETO,
 *               TRUST_PROXY, NODE_ENV, esDesarrollo
 *     clientes  { autenticacion, deportes, apuestas, transacciones, pagos, imagenes }
 *     log       crearLogger('bff')
 */

import { randomBytes } from 'node:crypto';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { crearManejadorErrores } from './middleware/errores.js';
import { crearGuardas } from './middleware/autenticar.js';
import { idSolicitud } from './middleware/idSolicitud.js';
import { crearLimites } from './middleware/limites.js';
import { noEncontrado } from './middleware/noEncontrado.js';
import { crearRutasAdmin } from './rutas/admin.js';
import { crearRutasApuestas } from './rutas/apuestas.js';
import { crearRutasAuth } from './rutas/auth.js';
import { crearRutasBilletera } from './rutas/billetera.js';
import { crearRutasCatalogos } from './rutas/catalogos.js';
import { crearRutasCalendario, crearRutasEncuentros } from './rutas/encuentros.js';
import { crearRutasImagenes } from './rutas/imagenes.js';
import { crearRutasOauth } from './rutas/oauth.js';
import { crearManejadorWebhook, crearRutasPagos } from './rutas/pagos.js';
import { crearRutasPromociones } from './rutas/promociones.js';
import { crearRutasSalud } from './rutas/salud.js';
import { asyncHandler } from './utils/asyncHandler.js';

/** 'true' -> true, '2' -> 2, 'loopback' -> 'loopback' (lo que entiende Express). */
export function valorTrustProxy(valor) {
  const texto = String(valor ?? '').trim();
  if (texto === '' || texto === 'false') return false;
  if (texto === 'true') return true;
  if (/^\d+$/.test(texto)) return Number(texto);
  return texto;
}

function origenesCors(lista) {
  const origenes = (Array.isArray(lista) ? lista : String(lista ?? '').split(','))
    .map((o) => String(o).trim())
    .filter(Boolean);
  return origenes.includes('*') ? true : origenes;
}

export function crearApp({ env, clientes, log }) {
  const app = express();
  const esDesarrollo = env.esDesarrollo ?? env.NODE_ENV !== 'production';
  const secretoCookie = env.COOKIE_SECRETO || randomBytes(32).toString('hex');

  app.disable('x-powered-by');
  // Detras de Vite (desarrollo) o de nginx (produccion) req.ip seria la del
  // proxy. Con 'loopback' Express confia en X-Forwarded-For solo si quien lo
  // manda esta en la misma maquina.
  app.set('trust proxy', valorTrustProxy(env.TRUST_PROXY));

  app.use(idSolicitud);

  /**
   * CORS restringido al origen del frontend. En desarrollo Vite hace de proxy
   * y el navegador ve un mismo origen; esto es la red de seguridad para cuando
   * se llame al API directo.
   */
  app.use(cors({ origin: origenesCors(env.CORS_ORIGIN), credentials: true, exposedHeaders: ['x-id-solicitud'] }));

  /**
   * Webhook de Wompi ANTES de express.json(): el checksum se calcula sobre el
   * cuerpo tal como llego. Si express.json lo parseara primero, el texto
   * original se perderia y la firma no se podria verificar.
   */
  app.post(
    '/api/pagos/webhook',
    express.raw({ type: '*/*', limit: '256kb' }),
    asyncHandler(crearManejadorWebhook({ clientes, log }))
  );

  // Limite de tamaño: sin el, un POST de 50 MB se traga la memoria del proceso.
  app.use(express.json({ limit: '100kb' }));
  // Firmada: la cookie del flujo OAuth (state, nonce, code_verifier) no se
  // puede fabricar ni modificar desde el navegador.
  app.use(cookieParser(secretoCookie));

  const guardas = crearGuardas({ clientes, log });
  const limites = crearLimites({ esDesarrollo });
  const dependencias = { env, clientes, log, guardas, limites };

  app.use('/api/salud', crearRutasSalud(dependencias));
  app.use('/api/auth/oauth', crearRutasOauth(dependencias));
  app.use('/api/auth', crearRutasAuth(dependencias));
  app.use('/api/catalogos', crearRutasCatalogos(dependencias));
  app.use('/api/encuentros', crearRutasEncuentros(dependencias));
  app.use('/api/calendario', crearRutasCalendario(dependencias));
  app.use('/api/promociones', crearRutasPromociones(dependencias));
  app.use('/api/apuestas', crearRutasApuestas(dependencias));
  app.use('/api/billetera', crearRutasBilletera(dependencias));
  app.use('/api/pagos', crearRutasPagos(dependencias));
  app.use('/api/imagenes', crearRutasImagenes(dependencias));
  app.use('/api/admin', crearRutasAdmin(dependencias));

  // Estos dos van de ULTIMOS y en este orden. El 404 tiene que ir despues de
  // todas las rutas reales, y el manejador de errores despues de todo.
  app.use('/api', noEncontrado);
  app.use(crearManejadorErrores({ log }));

  return app;
}
