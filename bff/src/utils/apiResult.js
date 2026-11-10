/**
 * Sobre de respuesta unico de toda la API: { success, data, message }.
 *
 * Es EXACTAMENTE el del monolito (server/utils/apiResult.js), que a su vez era
 * el que usaba el frontend cuando los datos venian de localStorage. Gracias a
 * eso las pantallas no cambian de contrato al pasar del monolito a los
 * microservicios: siguen escribiendo  if (!res.success) setError(res.message).
 *
 * Tambien los errores viajan con este sobre. El frontend lee el sobre; curl y
 * la pestaña Network leen el codigo HTTP. Por eso enviarError manda los dos.
 */

export const ok = (data = null, message = '') => ({ success: true, data, message });

export const fail = (message = 'Ocurrió un error inesperado', data = null) => ({
  success: false,
  data,
  message,
});

export const enviarOk = (res, data, message = '', codigo = 200) =>
  res.status(codigo).json(ok(data, message));

export const enviarError = (res, message, codigo = 400, data = null) =>
  res.status(codigo).json(fail(message, data));

/**
 * Error HTTP lanzado desde una ruta (validacion propia del BFF). Lo recoge el
 * manejador central igual que un error gRPC, asi hay UN solo lugar que arma la
 * respuesta de error.
 */
export class ErrorHttp extends Error {
  constructor(status, mensaje, datos = null) {
    super(mensaje);
    this.name = 'ErrorHttp';
    this.status = status;
    this.datos = datos;
  }
}
