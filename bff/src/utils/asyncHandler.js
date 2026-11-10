/**
 * Envuelve un manejador async para que sus rechazos lleguen a next().
 *
 * Express 4 no entiende promesas: si un `async (req, res)` lanza, la excepcion
 * queda como unhandled rejection, el middleware de errores nunca corre y la
 * peticion se queda colgada hasta que el navegador se rinde. En el BFF casi
 * todo es una llamada gRPC que puede fallar (servicio caido, plazo vencido), asi
 * que este envoltorio es lo que convierte un UNAVAILABLE en un 503 JSON decente.
 */
export const asyncHandler = (manejador) => (req, res, next) =>
  Promise.resolve(manejador(req, res, next)).catch(next);
