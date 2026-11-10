/**
 * Reglas de negocio de la autenticacion: login, registro, validacion y cierre
 * de sesion, perfil. Port de server/servicios/authServicio.js del monolito.
 *
 * Diferencia de forma con el monolito: alli los errores de negocio volvian en
 * el sobre { success:false, message }; aqui se LANZAN con los ayudantes de
 * @goldorado/comun y viajan como estado gRPC con el mismo mensaje en español.
 *
 * Fabrica con dependencias inyectadas (repositorios, tokens, auditoria, reloj)
 * para que las pruebas usen repositorios falsos sin base de datos.
 */

import bcrypt from 'bcryptjs';
import {
  invalido,
  noAutenticado,
  sinPermiso,
  noEncontrado,
  yaExiste,
  precondicion,
} from '@goldorado/comun';

import { aUsuarioPublico } from '../utils/usuarioPublico.js';
import { validarRegistro, validarFichaCliente, validarCambiosPerfil } from '../utils/validadores.js';
import { MENSAJE_SESION_EXPIRADA, esUuid } from './tokens.js';

/**
 * Costo de bcrypt. Cada +1 duplica el tiempo de calculo: encarece un ataque
 * por diccionario sin que el usuario note el login mas lento.
 */
export const RONDAS_BCRYPT = 10;

/**
 * Hash bcrypt de un valor aleatorio que nadie conoce. Cuando el usuario no
 * existe (o no tiene clave local) se compara contra este hash igual: asi
 * "no existe" tarda lo mismo que "clave mala" y el tiempo de respuesta no
 * delata que correos estan registrados. Es la misma idea del mensaje unico,
 * llevada al cronometro.
 */
const HASH_FICTICIO = '$2a$10$wHsMbUi54oXWHCzYDWQKOOZkg78LGZMEVnN9JAKb.u5FdSw7UpuR6';

export const MENSAJES = Object.freeze({
  // Mensaje UNICO para los fallos de credenciales. Decir "ese correo no existe"
  // convierte el formulario en un verificador de cuentas: un atacante prueba
  // correos y el sistema le confirma cuales estan registrados.
  credencialesInvalidas: 'Usuario o contraseña incorrectos',
  cuentaInactiva: 'Tu cuenta está inactiva. Comunícate con soporte.',
  correoDuplicado: 'Ya existe una cuenta con ese correo',
  documentoDuplicado: 'Ya existe una cuenta con ese documento',
  sinSesion: 'No hay sesión activa',
  usuarioNoEncontrado: 'Usuario no encontrado',
  perfilCompleto: 'Tu perfil ya está completo',
  perfilIncompleto: 'Completa tu perfil antes de editarlo',
});

/** Lanza INVALID_ARGUMENT con el primer error y TODOS en x-datos ({ campos }). */
function lanzarSiHayErrores(errores) {
  const campos = Object.keys(errores);
  if (campos.length > 0) throw invalido(errores[campos[0]], { campos: errores });
}

const texto = (valor) => String(valor ?? '').trim();

/** Ficha de Cliente con los espacios sobrantes quitados (lo que se guarda). */
const fichaLimpia = (v) => ({
  nombres: texto(v.nombres),
  apellidos: texto(v.apellidos),
  tipoDocumento: texto(v.tipoDocumento).toUpperCase(),
  numeroDocumento: texto(v.numeroDocumento),
  telefono: texto(v.telefono),
  fechaNacimiento: texto(v.fechaNacimiento),
});

export function crearServicioAutenticacion({
  usuarios,
  sesiones,
  tokens,
  emitirSesion,
  auditoria,
  reloj = { ahora: () => Date.now() },
  hasher = bcrypt,
}) {
  /* ------------------------------------------------------------------- login */

  /**
   * Inicio de sesion con correo O documento + contraseña.
   *
   * 1. SELECT con LEFT JOIN Usuario + Cliente y OUTER APPLY a rol y telefono.
   * 2. bcrypt.compare() EN NODE: SQL Server nunca ve la contraseña en claro ni
   *    la compara; solo guarda y devuelve el hash.
   * 3. Intento registrado en ms-transacciones, salga bien o mal (best-effort).
   * 4. UPDATE de ultimo_login, fila en Sesion y JWT con su jti.
   */
  async function iniciarSesion({ identificador, password, contexto = {} }) {
    const ident = texto(identificador);
    const clave = String(password ?? '');

    const registrar = (motivo, idUsuario) =>
      auditoria.intentoSesion({
        idUsuario,
        emailIntento: ident || '(vacío)',
        ip: contexto.ip,
        userAgent: contexto.userAgent,
        exitoso: false,
        motivoFallo: motivo,
        proveedor: 'LOCAL',
      });

    if (!ident || !clave) {
      registrar('Credenciales incompletas');
      throw noAutenticado(MENSAJES.credencialesInvalidas);
    }

    const fila = await usuarios.buscarPorIdentificador(ident);

    if (!fila) {
      // id_usuario queda ausente: no hay a quien apuntar, pero el intento se
      // registra igual. Esa es justamente la traza de un ataque por fuerza bruta.
      await hasher.compare(clave, HASH_FICTICIO);
      registrar('Usuario no encontrado');
      throw noAutenticado(MENSAJES.credencialesInvalidas);
    }

    const idUsuario = Number(fila.id_usuario);

    if (!fila.activo) {
      // Eliminacion logica: la fila sigue en la tabla pero no puede entrar.
      registrar('Cuenta inactiva', idUsuario);
      throw sinPermiso(MENSAJES.cuentaInactiva);
    }

    if (!fila.password_hash) {
      // Cuenta creada con Google/Microsoft: no tiene clave local. Para quien
      // teclea, es indistinguible de una clave equivocada.
      await hasher.compare(clave, HASH_FICTICIO);
      registrar('Cuenta sin contraseña local', idUsuario);
      throw noAutenticado(MENSAJES.credencialesInvalidas);
    }

    if (!(await hasher.compare(clave, fila.password_hash))) {
      registrar('Contraseña incorrecta', idUsuario);
      throw noAutenticado(MENSAJES.credencialesInvalidas);
    }

    await usuarios.actualizarUltimoLogin(idUsuario);
    const usuario = aUsuarioPublico(fila);
    const sesion = await emitirSesion({ idUsuario, rol: usuario.rol, proveedor: 'LOCAL', contexto });

    auditoria.intentoSesion({
      idUsuario,
      emailIntento: fila.email,
      ip: contexto.ip,
      userAgent: contexto.userAgent,
      exitoso: true,
      proveedor: 'LOCAL',
    });

    return { ...sesion, usuario, esNuevo: false };
  }

  /* ---------------------------------------------------------------- registro */

  /**
   * Alta de cliente.
   *
   * Las comprobaciones previas de correo y documento existen para dar un
   * mensaje util anclado al campo culpable. La garantia de verdad la dan los
   * UNIQUE de la base: entre el SELECT y el INSERT cabe otra peticion que
   * registre el mismo correo, y en esa carrera decide la restriccion. Por eso
   * el error del INSERT tambien se traduce, mirando CUAL restriccion salto.
   */
  async function registrar(valores, contexto = {}) {
    const email = texto(valores.email).toLowerCase();
    const password = String(valores.password ?? '');
    const ficha = fichaLimpia(valores);

    const tipos = await usuarios.listarTiposDocumento();
    lanzarSiHayErrores(
      validarRegistro(
        { ...ficha, email, password },
        { tiposValidos: tipos.map((t) => t.codigo), ahoraMs: reloj.ahora() }
      )
    );

    if (await usuarios.existeEmail(email)) throw yaExiste(MENSAJES.correoDuplicado);
    if (await usuarios.existeDocumento(ficha.numeroDocumento)) throw yaExiste(MENSAJES.documentoDuplicado);

    // El hash se calcula aqui. La contraseña en claro no llega jamas a la base.
    const passwordHash = await hasher.hash(password, RONDAS_BCRYPT);

    let fila;
    try {
      fila = await usuarios.crearCliente({ email, passwordHash, ...ficha });
    } catch (error) {
      if (error?.duplicado === 'email') throw yaExiste(MENSAJES.correoDuplicado);
      if (error?.duplicado === 'documento') throw yaExiste(MENSAJES.documentoDuplicado);
      throw error;
    }

    const usuario = aUsuarioPublico(fila);
    // Igual que en el monolito: al registrarse queda con la sesion iniciada.
    const sesion = await emitirSesion({ idUsuario: usuario.id, rol: usuario.rol, proveedor: 'LOCAL', contexto });

    auditoria.evento('REGISTRO', {
      idUsuario: usuario.id,
      ip: contexto.ip,
      detalle: { proveedor: 'LOCAL' },
    });

    return { ...sesion, usuario, esNuevo: true };
  }

  /* ------------------------------------------------------- token de seguridad */

  /**
   * Lo llama el BFF en CADA peticion protegida. Tres capas:
   *   1. firma y exp del JWT (sin tocar la base),
   *   2. la fila Sesion del jti: existe, no esta revocada, no vencio,
   *   3. el usuario sigue activo.
   * Cualquier fallo da el MISMO UNAUTHENTICATED.
   */
  async function validarToken(token) {
    const payload = tokens.verificar(token);
    if (!esUuid(payload.jti) || !payload.sub) throw noAutenticado(MENSAJE_SESION_EXPIRADA);

    const sesion = await sesiones.buscarParaValidar(payload.jti);
    const viva =
      sesion &&
      !sesion.revocada_en &&
      new Date(sesion.expira_en).getTime() > reloj.ahora() &&
      sesion.activo &&
      String(sesion.id_usuario) === String(payload.sub);
    if (!viva) throw noAutenticado(MENSAJE_SESION_EXPIRADA);

    return {
      idUsuario: Number(sesion.id_usuario),
      // El rol ACTUAL de la base, no el que quedo escrito en el token.
      rol: String(sesion.rol ?? 'CLIENTE').toLowerCase(),
      jti: payload.jti,
      perfilCompleto: Boolean(sesion.tiene_cliente),
      expiraEn: new Date(sesion.expira_en).toISOString(),
    };
  }

  /**
   * Cierre de sesion. Idempotente y silencioso: un token invalido o ya
   * revocado simplemente no tiene nada que cerrar. Se acepta un token vencido
   * (con firma valida) para dejar constancia del cierre en su fila.
   */
  async function cerrarSesion(token, contexto = {}) {
    let payload;
    try {
      payload = tokens.verificar(token, { ignorarVencimiento: true });
    } catch {
      return;
    }
    if (!esUuid(payload.jti)) return;

    const revocadas = await sesiones.revocar(payload.jti, 'CIERRE_SESION', new Date(reloj.ahora()));
    if (revocadas > 0) {
      auditoria.evento('CIERRE_SESION', {
        idUsuario: Number(payload.sub),
        ip: contexto.ip,
        detalle: { jti: payload.jti },
      });
    }
  }

  /** "Cerrar sesion en todos mis dispositivos". Devuelve cuantas cerro. */
  async function cerrarTodasLasSesiones(idUsuario) {
    const id = Number(idUsuario);
    if (!Number.isSafeInteger(id) || id <= 0) throw invalido(MENSAJES.usuarioNoEncontrado);

    const cerradas = await sesiones.revocarTodas(id, 'CIERRE_TODAS', new Date(reloj.ahora()));
    auditoria.evento('CIERRE_TODAS_SESIONES', {
      idUsuario: id,
      severidad: 'ADVERTENCIA',
      detalle: { sesionesCerradas: cerradas },
    });
    return cerradas;
  }

  /* ------------------------------------------------------------------ perfil */

  async function obtenerUsuario(idUsuario) {
    const fila = await usuarios.buscarPorId(Number(idUsuario));
    if (!fila) throw noEncontrado(MENSAJES.sinSesion);
    return aUsuarioPublico(fila);
  }

  /**
   * Edicion de nombres, apellidos y telefono (campos `optional`: lo que no
   * llega no se toca). Exige ficha de Cliente: no hay nombre que editar en
   * una cuenta que todavia no completo el perfil.
   */
  async function actualizarPerfil(idUsuario, cambios) {
    const limpios = {
      nombres: cambios.nombres === undefined || cambios.nombres === null ? undefined : texto(cambios.nombres),
      apellidos:
        cambios.apellidos === undefined || cambios.apellidos === null ? undefined : texto(cambios.apellidos),
      telefono: cambios.telefono === undefined || cambios.telefono === null ? undefined : texto(cambios.telefono),
    };
    lanzarSiHayErrores(validarCambiosPerfil(limpios));

    const fila = await usuarios.buscarPorId(Number(idUsuario));
    if (!fila) throw noEncontrado(MENSAJES.usuarioNoEncontrado);
    if (!fila.tiene_cliente) throw precondicion(MENSAJES.perfilIncompleto);

    const hayCambios = Object.values(limpios).some((v) => v !== undefined);
    if (!hayCambios) return aUsuarioPublico(fila);

    const actualizada = await usuarios.actualizarPerfil(Number(idUsuario), limpios);
    return aUsuarioPublico(actualizada);
  }

  /**
   * Ficha de Cliente para quien entro con Google/Microsoft. Mismas
   * validaciones del registro (mayor de edad incluido). El documento repetido
   * se revisa antes por el mensaje y despues por la carrera, como en registrar().
   */
  async function completarPerfil(idUsuario, valores, contexto = {}) {
    const id = Number(idUsuario);
    const fila = await usuarios.buscarPorId(id);
    if (!fila) throw noEncontrado(MENSAJES.usuarioNoEncontrado);
    if (fila.tiene_cliente) throw precondicion(MENSAJES.perfilCompleto);

    const ficha = fichaLimpia(valores);
    const tipos = await usuarios.listarTiposDocumento();
    lanzarSiHayErrores(
      validarFichaCliente(ficha, { tiposValidos: tipos.map((t) => t.codigo), ahoraMs: reloj.ahora() })
    );

    if (await usuarios.existeDocumento(ficha.numeroDocumento)) throw yaExiste(MENSAJES.documentoDuplicado);

    let actualizada;
    try {
      actualizada = await usuarios.completarPerfil(id, ficha);
    } catch (error) {
      if (error?.duplicado === 'cliente') throw precondicion(MENSAJES.perfilCompleto);
      if (error?.duplicado === 'documento') throw yaExiste(MENSAJES.documentoDuplicado);
      throw error;
    }

    auditoria.evento('PERFIL_COMPLETADO', { idUsuario: id, ip: contexto.ip });
    return aUsuarioPublico(actualizada);
  }

  async function listarTiposDocumento() {
    const tipos = await usuarios.listarTiposDocumento();
    return tipos.map((t) => ({ codigo: t.codigo, nombre: t.nombre }));
  }

  return {
    iniciarSesion,
    registrar,
    validarToken,
    cerrarSesion,
    cerrarTodasLasSesiones,
    obtenerUsuario,
    actualizarPerfil,
    completarPerfil,
    listarTiposDocumento,
  };
}
