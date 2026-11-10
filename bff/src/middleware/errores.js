/**
 * Manejador central de errores. Va montado de ultimo en app.js.
 *
 * Aqui terminan tres familias de errores:
 *   1. Errores gRPC de los microservicios: el codigo se traduce con la tabla de
 *      docs/API-REST.md, el `details` (ya en español) es el `message` y los
 *      datos de `x-datos` son el `data` ({ tokenDead: true }, { campos: {...} }).
 *   2. Errores del propio Express / multer: JSON mal formado, cuerpo o imagen
 *      demasiado grandes.
 *   3. Cualquier otra excepcion: 500 con un mensaje generico. El detalle real
 *      queda en el log; al navegador nunca le llega un stack ni el texto crudo
 *      de un error interno.
 */

import { fail } from '../utils/apiResult.js';
import { esErrorGrpc, MENSAJE_500, respuestaDeErrorGrpc } from '../utils/grpcHttp.js';

const MENSAJES_MULTER = {
  LIMIT_FILE_SIZE: 'La imagen supera 5 MB',
  LIMIT_FILE_COUNT: 'Envía una sola imagen',
  LIMIT_UNEXPECTED_FILE: 'Envía la imagen en el campo "imagen"',
  LIMIT_PART_COUNT: 'El formulario tiene demasiados campos',
  LIMIT_FIELD_COUNT: 'El formulario tiene demasiados campos',
  LIMIT_FIELD_VALUE: 'Un campo del formulario es demasiado largo',
};

export function crearManejadorErrores({ log }) {
  // eslint-disable-next-line no-unused-vars -- Express identifica el handler de
  // errores por su aridad de 4: quitar `next` lo convierte en middleware normal.
  return function manejadorErrores(error, req, res, next) {
    // Si ya salieron las cabeceras (un stream a medias), lo unico honesto es cortar.
    if (res.headersSent) {
      log.aviso(`${req.method} ${req.originalUrl}: error con la respuesta ya iniciada: ${error?.message}`);
      res.destroy(error);
      return;
    }

    if (esErrorGrpc(error)) {
      const { status, message, data } = respuestaDeErrorGrpc(error);
      const linea = `${req.method} ${req.originalUrl} -> ${status} (${error.servicioOrigen ?? 'grpc'}.${error.metodo ?? '?'} code ${error.code}: ${error.details})`;
      if (status >= 500) log.aviso(linea);
      else log.debug(linea);
      return res.status(status).json(fail(message, data));
    }

    if (error?.name === 'ErrorHttp') {
      return res.status(error.status).json(fail(error.message, error.datos ?? null));
    }

    // JSON mal formado en el body: lo lanza express.json(), no la aplicacion.
    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json(fail('El cuerpo de la petición no es un JSON válido'));
    }
    if (error?.type === 'entity.too.large') {
      return res.status(413).json(fail('El cuerpo de la petición es demasiado grande'));
    }
    if (error?.name === 'MulterError') {
      return res.status(400).json(fail(MENSAJES_MULTER[error.code] ?? 'El archivo enviado no es válido'));
    }

    const codigo = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (codigo === 500) {
      log.error(`${req.method} ${req.originalUrl}`, error);
      return res.status(500).json(fail(MENSAJE_500));
    }
    return res.status(codigo).json(fail(error.expose ? error.message : MENSAJE_500));
  };
}
