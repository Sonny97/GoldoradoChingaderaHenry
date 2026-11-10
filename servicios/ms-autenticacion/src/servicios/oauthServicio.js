/**
 * Inicio de sesion con Google y Microsoft: QUIEN es la persona y a que
 * Usuario de GolDorado corresponde.
 *
 * REGLAS DE VINCULACION (el orden importa):
 *   1. La identidad externa (proveedor, inquilino, sujeto) ya esta en
 *      Cuenta_Externa -> es ese usuario. El correo no se mira.
 *   2. No esta, pero ya hay un Usuario con ese correo:
 *        - GOOGLE con email_verified === true -> se vincula: Google garantiza
 *          que la persona controla ese buzon.
 *        - MICROSOFT -> NUNCA se vincula por correo. Microsoft no verifica el
 *          claim email: cualquiera puede crear un directorio y ponerse el
 *          correo de otro. Vincular por correo es la clase de fallo "nOAuth"
 *          (toma de cuentas ajenas). Se responde ALREADY_EXISTS y la persona
 *          entra con su clave.
 *   3. Nadie tiene ese correo -> Usuario nuevo SIN clave + rol CLIENTE +
 *      Cuenta_Externa, en una transaccion. Perfil INCOMPLETO: el proveedor no
 *      da documento, telefono ni fecha de nacimiento (CompletarPerfil).
 *
 * Despues: cuenta inactiva -> PERMISSION_DENIED; si no, Sesion + JWT propios
 * (el token del proveedor no sale de aqui ni se guarda).
 */

import { invalido, noAutenticado, noDisponible, precondicion, sinPermiso, yaExiste } from '@goldorado/comun';

import { aUsuarioPublico } from '../utils/usuarioPublico.js';
import { urlAutorizacion, intercambiarCodigo, verificarIdToken, jwksRemoto } from './proveedoresOidc.js';

export const MENSAJE_CORREO_REGISTRADO = 'Ya existe una cuenta con ese correo. Inicia sesión con tu contraseña.';
const MENSAJE_INACTIVA = 'Tu cuenta está inactiva. Comunícate con soporte.';

/** S256 de 32 bytes en base64url sin relleno: exactamente 43 caracteres. */
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function esUrlHttp(valor) {
  try {
    return ['http:', 'https:'].includes(new URL(String(valor)).protocol);
  } catch {
    return false;
  }
}

export function crearServicioOAuth({
  proveedores,
  usuarios,
  emitirSesion,
  auditoria,
  log,
  reloj = { ahora: () => Date.now() },
  fetch: fetchImpl = globalThis.fetch,
  obtenerJwks = jwksRemoto,
}) {
  function proveedorConfigurado(codigo) {
    const proveedor = proveedores[String(codigo ?? '').trim().toUpperCase()];
    if (!proveedor) throw invalido('Proveedor de identidad no soportado');
    if (!proveedor.habilitado) {
      throw precondicion(`El inicio de sesión con ${proveedor.nombre} no está configurado`);
    }
    return proveedor;
  }

  function listarProveedores() {
    return ['GOOGLE', 'MICROSOFT'].map((codigo) => ({
      codigo,
      nombre: proveedores[codigo].nombre,
      habilitado: proveedores[codigo].habilitado,
    }));
  }

  function urlAutorizacionExterna({ proveedor: codigo, redirectUri, state, nonce, codeChallenge }) {
    const proveedor = proveedorConfigurado(codigo);
    if (!esUrlHttp(redirectUri) || !state || !nonce || !CODE_CHALLENGE.test(String(codeChallenge ?? ''))) {
      throw invalido(`Faltan datos para iniciar sesión con ${proveedor.nombre}`);
    }
    return urlAutorizacion(proveedor, { redirectUri, state, nonce, codeChallenge });
  }

  /** Datos de Cuenta_Externa a partir de la identidad validada. */
  const cuentaDe = (identidad) => ({
    proveedor: identidad.proveedor,
    inquilino: identidad.inquilino,
    sujeto: identidad.sujeto,
    email: identidad.email,
    nombre: identidad.nombre,
  });

  /**
   * Aplica las reglas de vinculacion de la cabecera. Devuelve la fila del
   * usuario y si la cuenta se creo en este login.
   */
  async function resolverUsuario(proveedor, identidad, contexto, registrarFallo) {
    const buscarVinculada = async () => {
      const cuenta = await usuarios.buscarCuentaExterna(identidad);
      if (!cuenta) return null;
      // BIGINT llega como texto desde mssql: se normaliza antes de reusarlo.
      await usuarios.registrarUsoCuentaExterna(Number(cuenta.id_cuenta_externa), identidad);
      return usuarios.buscarPorId(Number(cuenta.id_usuario));
    };

    // 1. Identidad ya vinculada.
    const vinculada = await buscarVinculada();
    if (vinculada) return { fila: vinculada, esNuevo: false };

    if (!identidad.email) {
      registrarFallo('Proveedor sin correo');
      throw precondicion(
        `Tu cuenta de ${proveedor.nombre} no tiene un correo asociado. Regístrate con tu correo y contraseña.`
      );
    }

    // 2. Mismo correo en una cuenta existente.
    const existente = await usuarios.buscarPorEmail(identidad.email);
    if (existente) {
      const idUsuario = Number(existente.id_usuario);
      if (proveedor.codigo !== 'GOOGLE' || !identidad.emailVerificado) {
        registrarFallo('Correo ya registrado, vinculacion no permitida', idUsuario);
        throw yaExiste(MENSAJE_CORREO_REGISTRADO);
      }
      try {
        await usuarios.vincularCuentaExterna(idUsuario, cuentaDe(identidad));
      } catch (error) {
        // Dos callbacks simultaneos del mismo login: el otro ya vinculo.
        if (error?.duplicado === 'identidad_externa') {
          const otra = await buscarVinculada();
          if (otra) return { fila: otra, esNuevo: false };
        }
        if (error?.duplicado === 'proveedor_vinculado') {
          registrarFallo('Otra cuenta del proveedor ya vinculada', idUsuario);
          throw yaExiste(`Tu cuenta ya está vinculada a otra cuenta de ${proveedor.nombre}`);
        }
        throw error;
      }
      auditoria.evento('CUENTA_EXTERNA_VINCULADA', {
        idUsuario,
        ip: contexto.ip,
        detalle: { proveedor: proveedor.codigo, vinculo: 'cuenta_existente' },
      });
      return { fila: await usuarios.buscarPorId(idUsuario), esNuevo: false };
    }

    // 3. Cuenta nueva, sin clave y con el perfil incompleto.
    let fila;
    try {
      fila = await usuarios.crearUsuarioExterno(cuentaDe(identidad));
    } catch (error) {
      if (error?.duplicado === 'identidad_externa') {
        const otra = await buscarVinculada();
        if (otra) return { fila: otra, esNuevo: false };
      }
      // Alguien se registro con ese correo entre el SELECT y el INSERT.
      if (error?.duplicado === 'email') throw yaExiste(MENSAJE_CORREO_REGISTRADO);
      throw error;
    }
    auditoria.evento('CUENTA_EXTERNA_VINCULADA', {
      idUsuario: Number(fila.id_usuario),
      ip: contexto.ip,
      detalle: { proveedor: proveedor.codigo, vinculo: 'cuenta_nueva' },
    });
    return { fila, esNuevo: true };
  }

  async function iniciarSesionExterna({ proveedor: codigo, code, codeVerifier, redirectUri, nonce, contexto = {} }) {
    const proveedor = proveedorConfigurado(codigo);
    if (!code || !codeVerifier || !redirectUri || !nonce) {
      throw invalido(`Faltan datos para iniciar sesión con ${proveedor.nombre}`);
    }

    let correoIntento = '(desconocido)';
    const registrarFallo = (motivo, idUsuario) =>
      auditoria.intentoSesion({
        idUsuario,
        emailIntento: correoIntento,
        ip: contexto.ip,
        userAgent: contexto.userAgent,
        exitoso: false,
        motivoFallo: motivo,
        proveedor: proveedor.codigo,
      });

    let identidad;
    try {
      const idToken = await intercambiarCodigo(proveedor, { code, codeVerifier, redirectUri }, fetchImpl);
      identidad = await verificarIdToken(proveedor, idToken, nonce, { obtenerJwks, ahoraMs: reloj.ahora() });
    } catch (error) {
      if (!error?.tipoFallo) throw error;
      // El detalle tecnico va al log, nunca al cliente (ni el code ni tokens).
      log.aviso(`${proveedor.nombre}: ${error.message}`);
      if (error.tipoFallo === 'no_disponible') {
        registrarFallo('Proveedor no disponible');
        throw noDisponible(`No pudimos comunicarnos con ${proveedor.nombre}`);
      }
      registrarFallo('Token del proveedor inválido');
      throw noAutenticado(`No pudimos verificar tu cuenta de ${proveedor.nombre}`);
    }
    correoIntento = identidad.email ?? '(sin correo)';

    const { fila, esNuevo } = await resolverUsuario(proveedor, identidad, contexto, registrarFallo);
    const idUsuario = Number(fila.id_usuario);

    if (!fila.activo) {
      registrarFallo('Cuenta inactiva', idUsuario);
      throw sinPermiso(MENSAJE_INACTIVA);
    }

    await usuarios.actualizarUltimoLogin(idUsuario);
    const usuario = aUsuarioPublico(fila);
    const sesion = await emitirSesion({ idUsuario, rol: usuario.rol, proveedor: proveedor.codigo, contexto });

    auditoria.intentoSesion({
      idUsuario,
      emailIntento: fila.email,
      ip: contexto.ip,
      userAgent: contexto.userAgent,
      exitoso: true,
      proveedor: proveedor.codigo,
    });

    return { ...sesion, usuario, esNuevo };
  }

  return { listarProveedores, urlAutorizacionExterna, iniciarSesionExterna };
}
