/**
 * Inicio de sesion con Google y Microsoft (OpenID Connect + PKCE):
 * /api/auth/oauth/:proveedor  y  /api/auth/oauth/:proveedor/callback
 *
 * Reparto del trabajo:
 *   - El BFF genera `state` (anti-CSRF), `nonce` (ata el id_token a ESTE
 *     intento) y `code_verifier` (PKCE), los guarda en una cookie FIRMADA y
 *     httpOnly de 10 minutos, y solo le manda a ms-autenticacion el
 *     code_challenge. Los secretos de cliente de Google/Microsoft nunca salen
 *     de ms-autenticacion.
 *   - En el callback, el BFF comprueba que el `state` que trae el proveedor sea
 *     el de la cookie (si no, alguien esta intentando colar un login ajeno) y
 *     le entrega a ms-autenticacion el code + verifier + nonce. Ese servicio
 *     cambia el code por tokens, valida el id_token y emite NUESTRO JWT.
 *
 * El JWT viaja al frontend en el FRAGMENTO (#token=...): el fragmento no se
 * envia a ningun servidor, no queda en logs de acceso ni en el Referer.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Router } from 'express';

import { crearArmadorUsuario } from '../agregadores/usuario.js';
import { enviarError } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { contextoCliente, opciones, texto } from '../utils/contexto.js';
import { esErrorGrpc, respuestaDeErrorGrpc } from '../utils/grpcHttp.js';

export const COOKIE_OAUTH = 'gd_oauth';
const RUTA_COOKIE = '/api/auth/oauth';
const DIEZ_MINUTOS = 10 * 60 * 1000;
const DESTINO_POR_DEFECTO = '/inicio';
const MENSAJE_STATE = 'La solicitud de inicio de sesión no es válida o venció';

const PROVEEDORES = Object.freeze({ google: 'GOOGLE', microsoft: 'MICROSOFT' });

const aleatorio = () => randomBytes(32).toString('base64url');

/**
 * Solo rutas INTERNAS del frontend. Sin esta regla, ?destino=https://evil.com
 * convertiria el login en un redirect abierto; '//evil.com' y '/\evil.com' los
 * navegadores los interpretan como otra maquina.
 */
export function destinoSeguro(valor) {
  const destino = typeof valor === 'string' ? valor.trim() : '';
  if (!destino || destino.length > 300) return DESTINO_POR_DEFECTO;
  if (!destino.startsWith('/') || destino.startsWith('//') || destino.startsWith('/\\')) return DESTINO_POR_DEFECTO;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(destino)) return DESTINO_POR_DEFECTO;
  return destino;
}

function mismoTexto(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

function mensajeDe(error, porDefecto) {
  if (esErrorGrpc(error)) return respuestaDeErrorGrpc(error).message;
  return porDefecto;
}

export function crearRutasOauth({ clientes, env, log }) {
  const router = Router();
  const usuarios = crearArmadorUsuario({ clientes, log });

  const webUrl = String(env.WEB_URL).replace(/\/+$/, '');
  const apiPublica = String(env.URL_PUBLICA_API).replace(/\/+$/, '');
  const opcionesCookie = {
    httpOnly: true,
    sameSite: 'lax',
    path: RUTA_COOKIE,
    secure: env.NODE_ENV === 'production',
  };

  const callbackDe = (slug) => `${apiPublica}/api/auth/oauth/${slug}/callback`;
  const conError = (mensaje) => `${webUrl}/auth/callback#error=${encodeURIComponent(mensaje)}`;

  /** 'Google' -> 'google'; null si no es un proveedor soportado. */
  function proveedorDe(req) {
    const slug = String(req.params.proveedor ?? '').toLowerCase();
    return PROVEEDORES[slug] ? { slug, codigo: PROVEEDORES[slug] } : null;
  }

  router.get(
    '/:proveedor',
    asyncHandler(async (req, res) => {
      const proveedor = proveedorDe(req);
      if (!proveedor) return enviarError(res, 'Proveedor de inicio de sesión no soportado', 404);

      const state = aleatorio();
      const nonce = aleatorio();
      const verifier = aleatorio();
      const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
      const destino = destinoSeguro(req.query.destino);

      try {
        const { url } = await clientes.autenticacion.UrlAutorizacionExterna(
          { proveedor: proveedor.codigo, redirectUri: callbackDe(proveedor.slug), state, nonce, codeChallenge },
          opciones(req)
        );
        res.cookie(
          COOKIE_OAUTH,
          { state, nonce, verifier, proveedor: proveedor.codigo, destino },
          { ...opcionesCookie, signed: true, maxAge: DIEZ_MINUTOS }
        );
        return res.redirect(302, url);
      } catch (error) {
        log.aviso(`UrlAutorizacionExterna(${proveedor.codigo}) fallo: ${error?.details ?? error?.message}`);
        return res.redirect(302, conError(mensajeDe(error, 'No pudimos conectar con el proveedor')));
      }
    })
  );

  router.get(
    '/:proveedor/callback',
    asyncHandler(async (req, res) => {
      const proveedor = proveedorDe(req);
      if (!proveedor) return enviarError(res, 'Proveedor de inicio de sesión no soportado', 404);

      // La cookie sirve para UN intento: se borra pase lo que pase.
      const guardado = req.signedCookies?.[COOKIE_OAUTH];
      res.clearCookie(COOKIE_OAUTH, opcionesCookie);

      const errorProveedor = texto(req.query.error);
      if (errorProveedor) {
        const mensaje =
          errorProveedor === 'access_denied'
            ? 'Cancelaste el inicio de sesión'
            : `El proveedor no completó el inicio de sesión: ${texto(req.query.error_description) || errorProveedor}`;
        return res.redirect(302, conError(mensaje.slice(0, 300)));
      }

      const code = texto(req.query.code);
      const valido =
        guardado &&
        typeof guardado === 'object' &&
        guardado.proveedor === proveedor.codigo &&
        mismoTexto(texto(req.query.state), guardado.state) &&
        code;
      if (!valido) return res.redirect(302, conError(MENSAJE_STATE));

      try {
        const sesion = await clientes.autenticacion.IniciarSesionExterna(
          {
            proveedor: proveedor.codigo,
            code,
            codeVerifier: guardado.verifier,
            redirectUri: callbackDe(proveedor.slug),
            nonce: guardado.nonce,
            contexto: contextoCliente(req),
          },
          opciones(req)
        );
        if (sesion.esNuevo) await usuarios.asegurarBilletera(Number(sesion.usuario?.id), req);

        const destino = destinoSeguro(guardado.destino);
        const fragmento =
          `token=${encodeURIComponent(sesion.token)}` +
          `&nuevo=${sesion.esNuevo ? 1 : 0}` +
          `&destino=${encodeURIComponent(destino)}`;
        return res.redirect(302, `${webUrl}/auth/callback#${fragmento}`);
      } catch (error) {
        log.aviso(`IniciarSesionExterna(${proveedor.codigo}) fallo: ${error?.details ?? error?.message}`);
        return res.redirect(302, conError(mensajeDe(error, 'No pudimos completar el inicio de sesión')));
      }
    })
  );

  return router;
}
