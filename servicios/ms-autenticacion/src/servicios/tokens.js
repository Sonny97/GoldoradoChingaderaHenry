/**
 * JWT de acceso + su fila en Sesion (el "token de seguridad").
 *
 * En el monolito el JWT era AUTOCONTENIDO y no se podia revocar antes de
 * vencer (por eso JWT_EXPIRES_IN era corto). Ahora cada token lleva un `jti`
 * que es la PK de la tabla Sesion: la firma prueba que lo emitimos nosotros y
 * la fila dice si sigue vivo. Cerrar sesion = revocar la fila, y el token deja
 * de servir en la siguiente peticion aunque su exp diga otra cosa.
 *
 * El payload lleva SOLO sub, rol y jti. Nunca correo, documento ni saldo: un
 * JWT va firmado, no cifrado; cualquiera lo lee pegandolo en jwt.io.
 *
 * El reloj se inyecta (iat y clockTimestamp) para que las pruebas de
 * vencimiento no tengan que esperar dos horas.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { noAutenticado } from '@goldorado/comun';

/**
 * El MISMO mensaje para token vencido, falsificado, mal formado o revocado:
 * distinguirlos solo le sirve a quien esta probando tokens.
 */
export const MENSAJE_SESION_EXPIRADA = 'Tu sesión expiró, inicia sesión de nuevo';

const ALGORITMO = 'HS256';

export const esUuid = (valor) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(valor ?? ''));

/**
 * JWT_EXPIRES_IN admite '2h', '30m' o segundos. Ojo con el numero en texto:
 * jsonwebtoken lee el string '7200' como 7200 MILISEGUNDOS (formato de `ms`),
 * no segundos. Por eso los digitos solos se convierten a numero aqui.
 */
export function normalizarDuracion(valor) {
  const texto = String(valor ?? '').trim();
  return /^\d+$/.test(texto) ? Number(texto) : texto;
}

export function crearTokens({ secreto, duracion, reloj = { ahora: () => Date.now() } }) {
  const expiresIn = normalizarDuracion(duracion);
  const segundosAhora = () => Math.floor(reloj.ahora() / 1000);

  function firmar({ idUsuario, rol, jti }) {
    const iat = segundosAhora();
    const token = jwt.sign({ sub: String(idUsuario), rol, jti, iat }, secreto, {
      algorithm: ALGORITMO,
      expiresIn,
    });
    // La vigencia de la fila Sesion sale del exp REAL del token: una sola fuente.
    const { exp } = jwt.decode(token);
    return { token, emitidaEn: new Date(iat * 1000), expiraEn: new Date(exp * 1000) };
  }

  /**
   * Payload del token, o UNAUTHENTICATED con el mensaje unico.
   * `algorithms` fijo: un token que diga alg "none" o RS256 se rechaza aunque
   * el resto parezca valido (ataque de confusion de algoritmo).
   */
  function verificar(token, { ignorarVencimiento = false } = {}) {
    try {
      return jwt.verify(String(token ?? ''), secreto, {
        algorithms: [ALGORITMO],
        clockTimestamp: segundosAhora(),
        ignoreExpiration: ignorarVencimiento,
      });
    } catch {
      throw noAutenticado(MENSAJE_SESION_EXPIRADA);
    }
  }

  // Falla al arrancar, y no en el primer login, si JWT_EXPIRES_IN no sirve.
  const prueba = firmar({ idUsuario: 0, rol: 'cliente', jti: randomUUID() });
  if (!(prueba.expiraEn > prueba.emitidaEn)) {
    throw new Error(`JWT_EXPIRES_IN invalido ("${duracion}"): usa por ejemplo 2h, 30m o 7200`);
  }

  return { firmar, verificar };
}

/**
 * Emite una sesion completa: jti nuevo -> JWT -> fila en Sesion.
 *
 * La fila se escribe ANTES de devolver el token: un token cuya fila no llego a
 * la base seria rechazado por ValidarToken en la primera peticion.
 */
export function crearEmisorSesiones({ tokens, sesiones, generarJti = randomUUID }) {
  return async function emitirSesion({ idUsuario, rol, proveedor, contexto = {} }) {
    const jti = generarJti();
    const { token, emitidaEn, expiraEn } = tokens.firmar({ idUsuario, rol, jti });
    await sesiones.crear({
      jti,
      idUsuario,
      proveedor,
      emitidaEn,
      expiraEn,
      ip: contexto.ip || null,
      userAgent: contexto.userAgent || null,
    });
    return { token, expiraEn: expiraEn.toISOString() };
  };
}
