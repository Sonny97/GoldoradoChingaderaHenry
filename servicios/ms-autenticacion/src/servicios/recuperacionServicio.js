/**
 * Recuperacion de contraseña en 4 pasos (port EXACTO del monolito, con los
 * mismos mensajes), ahora persistida en Solicitud_Recuperacion en vez de un
 * Map en memoria.
 *
 *   1. BuscarCuenta        identificador -> destinos ENMASCARADOS
 *   2. SolicitarCodigo     emite el codigo (se guarda solo su hash bcrypt)
 *   3. VerificarCodigo     codigo -> resetToken (con tope de intentos)
 *   4. RestablecerPassword resetToken + clave nueva (de un solo uso)
 *
 * No hay proveedor real de correo ni SMS. En desarrollo el codigo es fijo
 * (OTP_CODIGO_DEV) y vuelve en codigoDev para poder probar el flujo; en
 * produccion es aleatorio, NO vuelve, y el log dice que nadie lo envio.
 *
 * Reloj inyectado: las pruebas recorren el vencimiento sin esperar 10 minutos.
 */

import bcrypt from 'bcryptjs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { invalido, noEncontrado, precondicion } from '@goldorado/comun';

import { enmascararEmail, enmascararTelefono } from '../utils/mask.js';
import { errorPassword } from '../utils/validadores.js';
import { RONDAS_BCRYPT } from './autenticacionServicio.js';

export const MENSAJES_RECUPERACION = Object.freeze({
  cuentaNoEncontrada: 'No encontramos una cuenta con esos datos',
  sinTelefono: 'Esta cuenta no tiene un teléfono registrado',
  solicitudInvalida: 'La solicitud no es válida, empieza de nuevo',
  demasiadosIntentos: 'Demasiados intentos, solicita un código nuevo',
  enlaceInvalido: 'El enlace de recuperación no es válido',
  cuentaPerdida: 'No encontramos la cuenta',
  noActualizada: 'No pudimos actualizar tu contraseña',
});

const M = MENSAJES_RECUPERACION;

/** 6 digitos uniformes (randomInt usa el CSPRNG; Math.random no sirve aqui). */
const codigoAleatorio = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const msDe = (fecha) => new Date(fecha).getTime();

export function crearServicioRecuperacion({
  usuarios,
  recuperaciones,
  auditoria,
  log,
  config,
  reloj = { ahora: () => Date.now() },
  hasher = bcrypt,
  generarCodigo = codigoAleatorio,
  generarToken = () => randomBytes(24).toString('hex'),
  generarResetToken = randomUUID,
}) {
  const { esDesarrollo, codigoDev, ttlMs, maxIntentos } = config;

  /**
   * Paso 1: a que cuenta pertenece el identificador, con los destinos
   * ENMASCARADOS.
   *
   * NOTA DE SEGURIDAD (del monolito, se mantiene): un backend de produccion
   * responderia con mascaras genericas aunque la cuenta no exista, para no
   * permitir enumeracion. Aqui se falla explicitamente porque es una demo y el
   * usuario necesita saber que se equivoco de correo. Es una decision
   * consciente, no un descuido.
   */
  async function buscarCuenta(identificador) {
    const fila = await usuarios.buscarPorIdentificador(String(identificador ?? '').trim());
    if (!fila) throw noEncontrado(M.cuentaNoEncontrada);

    return {
      idUsuario: Number(fila.id_usuario),
      emailEnmascarado: enmascararEmail(fila.email),
      telefonoEnmascarado: enmascararTelefono(fila.telefono),
      tieneEmail: Boolean(fila.email),
      tieneSms: Boolean(fila.telefono),
    };
  }

  /** Paso 2: emitir el codigo. */
  async function solicitarCodigo({ identificador, metodo: metodoPedido, contexto = {} }) {
    const fila = await usuarios.buscarPorIdentificador(String(identificador ?? '').trim());
    if (!fila) throw noEncontrado(M.cuentaNoEncontrada);

    const metodo = metodoPedido === 'sms' ? 'sms' : 'email';
    if (metodo === 'sms' && !fila.telefono) throw precondicion(M.sinTelefono);

    const idUsuario = Number(fila.id_usuario);
    const token = generarToken();
    const ahora = reloj.ahora();
    const expiraEnMs = ahora + ttlMs;
    const codigo = esDesarrollo ? String(codigoDev) : generarCodigo();

    // Solo el HASH llega a la base: quien lea la tabla no puede completar
    // recuperaciones ajenas.
    await recuperaciones.crear({
      token,
      idUsuario,
      metodo,
      codigoHash: await hasher.hash(codigo, RONDAS_BCRYPT),
      expiraEn: new Date(expiraEnMs),
      creadaEn: new Date(ahora),
      ip: contexto.ip || null,
    });

    if (!esDesarrollo) {
      log.aviso(
        `Codigo de recuperacion emitido para el usuario ${idUsuario} por ${metodo}, pero no hay ` +
          'proveedor de correo/SMS configurado: el codigo no se envio a ningun lado.'
      );
    }

    auditoria.evento('RECUPERACION_SOLICITADA', { idUsuario, ip: contexto.ip, detalle: { metodo } });

    return {
      token,
      metodo,
      destinoEnmascarado: metodo === 'sms' ? enmascararTelefono(fila.telefono) : enmascararEmail(fila.email),
      expiraEnMs,
      // Solo en desarrollo. En produccion queda undefined y no viaja.
      codigoDev: esDesarrollo ? codigo : undefined,
    };
  }

  /**
   * Paso 3: verificar el codigo.
   *
   * NO consume la solicitud al acertar: la marca verificada y le adjunta un
   * resetToken. Si la consumiera, pulsar "Cancelar" desde el paso de nueva
   * contraseña devolveria al usuario a un paso OTP cuyo token ya no sirve, y
   * cualquier codigo que tecleara fallaria sin explicacion. Solo el paso 4
   * consume.
   *
   * `tokenDead: true` (en x-datos) es una señal ESTRUCTURAL para la interfaz:
   * este token ya no sirve, hay que volver a elegir metodo. Detectarlo con una
   * expresion regular sobre el mensaje se rompe al reescribir el texto.
   */
  async function verificarCodigo({ token, codigo }) {
    const muerto = (mensaje) => precondicion(mensaje, { tokenDead: true });

    const datos = await recuperaciones.buscarPorToken(token);
    const ahora = reloj.ahora();
    // Lo que en memoria era "no esta en el Map": inexistente, vencida o ya usada.
    if (!datos || datos.usada_en || msDe(datos.expira_en) <= ahora) throw muerto(M.solicitudInvalida);

    // En el monolito la solicitud agotada se borraba; aqui queda para auditoria
    // con intentos = tope, y esta guarda es la que la declara muerta.
    if (datos.intentos >= maxIntentos) throw muerto(M.demasiadosIntentos);

    const coincide = await hasher.compare(String(codigo ?? '').trim(), datos.codigo_hash);

    if (!coincide) {
      // El incremento es atomico en la base y devuelve null si ya estaba en el tope.
      const usados = await recuperaciones.sumarIntento(datos.token, maxIntentos);
      const restantes = usados === null ? 0 : maxIntentos - usados;

      // Al agotar los intentos se invalida AQUI MISMO y se dice claramente.
      // Dejar el token vivo un intento mas dejaria al usuario tecleando en algo
      // que ya va a rechazar todo.
      if (restantes <= 0) throw muerto(M.demasiadosIntentos);

      throw invalido(
        `El código es incorrecto. Te ${restantes === 1 ? 'queda' : 'quedan'} ` +
          `${restantes} ${restantes === 1 ? 'intento' : 'intentos'}.`
      );
    }

    const resetToken = generarResetToken();
    const marcada = await recuperaciones.marcarVerificada(datos.token, resetToken, new Date(ahora));
    if (!marcada) throw muerto(M.solicitudInvalida); // se consumio en paralelo

    return { resetToken };
  }

  /**
   * Paso 4: guardar la contraseña nueva. Consumo, cambio de clave y revocacion
   * de TODAS las sesiones van en una sola transaccion (recuperacionRepo).
   */
  async function restablecerPassword({ resetToken, password, contexto = {} }) {
    const errorClave = errorPassword(password);
    if (errorClave) throw invalido(errorClave, { campos: { password: errorClave } });

    const datos = await recuperaciones.buscarPorResetToken(resetToken);
    const ahora = reloj.ahora();
    if (!datos || !datos.verificada_en || datos.usada_en || msDe(datos.expira_en) <= ahora) {
      throw precondicion(M.enlaceInvalido);
    }

    const idUsuario = Number(datos.id_usuario);
    // Con FK_SolicitudRecuperacion_Usuario no deberia pasar; se conserva el
    // mensaje del monolito por si algun dia hay borrado fisico de usuarios.
    const fila = await usuarios.buscarPorId(idUsuario);
    if (!fila) throw noEncontrado(M.cuentaPerdida);

    const passwordHash = await hasher.hash(String(password), RONDAS_BCRYPT);
    const resultado = await recuperaciones.consumirYCambiarPassword({
      token: datos.token,
      idUsuario,
      passwordHash,
      ahora: new Date(ahora),
    });

    // Un resetToken es de un solo uso: si otra peticion lo consumio primero, este no vale.
    if (!resultado.consumida) throw precondicion(M.enlaceInvalido);
    if (!resultado.actualizado) throw precondicion(M.noActualizada);

    auditoria.evento('RECUPERACION_COMPLETADA', {
      idUsuario,
      ip: contexto.ip,
      severidad: 'ADVERTENCIA',
      detalle: { metodo: datos.metodo, sesionesRevocadas: resultado.sesionesRevocadas },
    });

    return { email: fila.email };
  }

  return { buscarCuenta, solicitarCodigo, verificarCodigo, restablecerPassword };
}
