/**
 * Sobre de respuesta unico de toda la capa de servicios.
 *
 * Contrato: TODA funcion de services/ resuelve a exactamente
 * { success: boolean, data: any, message: string }.
 *
 * Los errores de negocio (clave incorrecta, correo duplicado, OTP vencido) NO
 * lanzan: devuelven fail(). Asi el caller siempre escribe
 *   if (!res.success) setError(res.message)
 * y nunca necesita try/catch. El dia que esto se cambie por una API real, la
 * firma no cambia.
 */

export const ok = (data = null, message = '') => ({ success: true, data, message });

export const fail = (message = 'Ocurrio un error inesperado', data = null) => ({
  success: false,
  data,
  message,
});
