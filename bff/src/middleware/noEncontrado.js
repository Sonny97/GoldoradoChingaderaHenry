/**
 * Ruta inexistente bajo /api.
 *
 * Sin esto, Express responde su pagina HTML de "Cannot GET /api/loquesea" y el
 * frontend intenta hacerle JSON.parse a un <!DOCTYPE html>, con lo que el error
 * que ve el usuario no tiene nada que ver con lo que paso.
 */

import { fail } from '../utils/apiResult.js';

export function noEncontrado(req, res) {
  res.status(404).json(fail(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
}
