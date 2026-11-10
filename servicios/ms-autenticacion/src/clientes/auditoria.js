/**
 * Auditoria hacia ms-transacciones (MongoDB): intentos de sesion y eventos de
 * seguridad. Es lo que en el monolito eran las tablas Log_Sesion y los
 * registros de seguridad en SQL Server.
 *
 * BEST-EFFORT A PROPOSITO (CONVENCIONES §4.5): si Mongo o ms-transacciones
 * estan caidos, el login funciona igual. Por eso:
 *   - cada llamada va por llamadaOpcional(): nunca lanza, solo deja un aviso;
 *   - los servicios NO esperan la promesa: un ms-transacciones lento no puede
 *     sumarle segundos a un inicio de sesion.
 */

import { crearClienteGrpc, llamadaOpcional, sinVacios } from '@goldorado/comun';

const ORIGEN = 'ms-autenticacion';

/** Para MS_TRANSACCIONES_URL=apagado (y para pruebas que no miran la auditoria). */
export const auditoriaApagada = Object.freeze({
  intentoSesion: async () => null,
  evento: async () => null,
  cerrar: () => {},
});

export function crearAuditoria({ direccion, tokenInterno, log, plazoMs = 3000 }) {
  // 'apagado' y no vacio: cargarEnv trata una variable vacia como ausente y le
  // pone el valor por defecto (localhost:50054).
  if (!direccion || String(direccion).trim().toLowerCase() === 'apagado') {
    log.aviso('MS_TRANSACCIONES_URL=apagado: los intentos de sesion y eventos de seguridad no se registran.');
    return auditoriaApagada;
  }

  const cliente = crearClienteGrpc('transacciones', { direccion, tokenInterno, plazoMs });

  // Promise.resolve().then(): si el cliente lanzara de forma sincrona (un dato
  // que no serializa), tambien cae dentro de llamadaOpcional.
  const opcional = (metodo, mensaje, descripcion) =>
    llamadaOpcional(Promise.resolve().then(() => cliente[metodo](mensaje)), log, descripcion);

  return {
    /** IntentoSesion de transacciones.proto. idUsuario ausente = el correo no existe. */
    intentoSesion({ idUsuario, emailIntento, ip, userAgent, exitoso, motivoFallo, proveedor }) {
      return opcional(
        'RegistrarIntentoSesion',
        sinVacios({
          idUsuario: idUsuario ?? undefined,
          emailIntento: String(emailIntento || '(vacío)').slice(0, 150),
          ip: ip || '0.0.0.0',
          userAgent: userAgent ? String(userAgent).slice(0, 255) : undefined,
          exitoso: Boolean(exitoso),
          motivoFallo: exitoso ? undefined : motivoFallo,
          proveedor,
        }),
        'RegistrarIntentoSesion'
      );
    },

    /** EventoSeguridad: REGISTRO, CIERRE_SESION, RECUPERACION_COMPLETADA... */
    evento(tipo, { idUsuario, ip, severidad = 'INFO', detalle } = {}) {
      return opcional(
        'RegistrarEventoSeguridad',
        sinVacios({
          tipo,
          idUsuario: idUsuario ?? undefined,
          ip: ip || undefined,
          severidad,
          detalle: detalle ? JSON.stringify(detalle) : undefined,
          origen: ORIGEN,
        }),
        `RegistrarEventoSeguridad ${tipo}`
      );
    },

    cerrar: () => cliente.cerrar(),
  };
}
