/**
 * Guardas de autenticacion y autorizacion.
 *
 * El BFF NO conoce JWT_SECRET ni verifica firmas: en cada peticion protegida le
 * pregunta a ms-autenticacion.ValidarToken, que revisa firma, vigencia y que la
 * sesion (jti) no este revocada en la tabla Sesion. Asi un "cerrar sesion"
 * deja el token inservible en el acto, cosa que el monolito no podia hacer.
 *
 *   autenticar              corta si no hay token valido (401) o si no se pudo
 *                           verificar (503: no es culpa del usuario).
 *   autenticarOpcional      deja pasar siempre; rellena req.usuario si lo hay.
 *   requiereRol(...roles)   403 si el rol del token no esta en la lista.
 *   requierePerfilCompleto  403 si entro con Google/Microsoft y le falta la ficha.
 */

import { CODIGOS } from '@goldorado/comun';

import { fail } from '../utils/apiResult.js';
import { opciones, tokenDeCabecera } from '../utils/contexto.js';

/** Codigos con los que ms-autenticacion dice "ese token no sirve". */
const TOKEN_RECHAZADO = new Set([
  CODIGOS.UNAUTHENTICATED,
  CODIGOS.INVALID_ARGUMENT,
  CODIGOS.NOT_FOUND,
  CODIGOS.PERMISSION_DENIED,
]);

export function crearGuardas({ clientes, log }) {
  /** { usuario } si el token sirve, { rechazado } si no, lanza si no se pudo saber. */
  async function validar(req, token) {
    try {
      const r = await clientes.autenticacion.ValidarToken({ token }, opciones(req));
      return {
        usuario: {
          idUsuario: Number(r.idUsuario),
          rol: String(r.rol ?? '').toLowerCase(),
          perfilCompleto: Boolean(r.perfilCompleto),
          jti: r.jti,
          token,
        },
      };
    } catch (error) {
      if (TOKEN_RECHAZADO.has(error?.code)) return { rechazado: true };
      throw error;
    }
  }

  function autenticar(req, res, next) {
    const token = tokenDeCabecera(req);
    if (!token) {
      return res.status(401).json(fail('Debes iniciar sesión para continuar'));
    }

    return validar(req, token).then(
      ({ usuario }) => {
        // Un token expirado, revocado o falsificado dan el mismo mensaje a
        // proposito: distinguirlos le confirma a un atacante que su token SI
        // era valido.
        if (!usuario) return res.status(401).json(fail('Tu sesión expiró, inicia sesión de nuevo'));
        req.usuario = usuario;
        return next();
      },
      (error) => {
        log.aviso(`ValidarToken fallo: ${error?.details ?? error?.message}`);
        return res.status(503).json(fail('No pudimos verificar tu sesión. Intenta de nuevo.'));
      }
    );
  }

  function autenticarOpcional(req, res, next) {
    const token = tokenDeCabecera(req);
    req.usuario = null;
    if (!token) return next();
    return validar(req, token)
      .then(({ usuario }) => {
        req.usuario = usuario ?? null;
      })
      .catch(() => {
        req.usuario = null;
      })
      .finally(() => next());
  }

  return { autenticar, autenticarOpcional };
}

/**
 * requiereRol('admin')  o  requiereRol('admin', { mensaje: '...' }) para un 403
 * con texto propio (el ultimo argumento puede ser un objeto de opciones).
 */
export function requiereRol(...roles) {
  const opcionesRol = typeof roles.at(-1) === 'object' ? roles.pop() : {};
  const mensaje = opcionesRol?.mensaje ?? 'No tienes permiso para hacer esto';
  const permitidos = new Set(roles.map((r) => r.toLowerCase()));
  return (req, res, next) => {
    if (!req.usuario || !permitidos.has(req.usuario.rol)) {
      return res.status(403).json(fail(mensaje));
    }
    return next();
  };
}

export function requierePerfilCompleto(mensaje = 'Completa tu perfil para continuar') {
  return (req, res, next) => {
    if (!req.usuario?.perfilCompleto) {
      return res.status(403).json(fail(mensaje, { perfilIncompleto: true }));
    }
    return next();
  };
}
