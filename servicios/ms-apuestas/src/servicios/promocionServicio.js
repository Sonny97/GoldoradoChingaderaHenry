/**
 * Promociones: listado vigente, la del banner y el detalle.
 *
 * Las reglas son del monolito (promocionRepo + rutas): solo vigentes en el
 * listado, la destacada cae a la primera vigente si ninguna esta marcada, y
 * los mensajes de "no encontrada" son los mismos que veia el frontend.
 */

import { noEncontrado } from '@goldorado/comun';

/** @param {{ repo: object }} o */
export function crearServicioPromociones({ repo }) {
  /** `limite` es optional en el proto: undefined (o 0) = sin limite, como el `if (limite)` del monolito. */
  async function listar({ limite, excluirDestacada = false } = {}) {
    const n = Number(limite);
    return repo.listarVigentes({
      limite: Number.isInteger(n) && n > 0 ? n : null,
      excluirDestacada: Boolean(excluirDestacada),
    });
  }

  async function destacada() {
    const promocion = await repo.destacada();
    if (!promocion) throw noEncontrado('No hay promociones disponibles');
    return promocion;
  }

  async function obtener(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw noEncontrado('Promoción no encontrada');
    const promocion = await repo.porId(n);
    if (!promocion) throw noEncontrado('Promoción no encontrada');
    return promocion;
  }

  return { listar, destacada, obtener };
}
