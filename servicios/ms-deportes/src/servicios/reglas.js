/**
 * Reglas puras de los filtros: que estado es valido, que limite se usa, que id
 * se acepta. Sin base y sin gRPC, para probarlas con node --test.
 *
 * La base sigue siendo la garantia (CHK_Encuentro_Estado); esto es la
 * comodidad de responder bien ANTES de consultar.
 */

import { invalido } from '@goldorado/comun';

/**
 * Los estados que acepta CHK_Encuentro_Estado, en ORDEN DE RELEVANCIA (el mismo
 * del CASE de repositorios/encuentroRepo.js).
 */
export const ESTADOS_ENCUENTRO = Object.freeze(['live', 'upcoming', 'finished', 'canceled']);

/** Cuantos destacados muestra la home si no se pide otra cantidad (LimiteRequest = 0). */
export const LIMITE_DESTACADOS = 4;

/** Ningun listado devuelve mas que esto de una vez, lo pida quien lo pida. */
export const LIMITE_MAXIMO = 200;

/** Tope de ids en ObtenerEncuentrosPorIds: un IN (...) sin limite es una consulta sin limite. */
export const MAX_IDS = 500;

/**
 * Filtro de estado de ListarEncuentros.
 *
 *  - '' o 'all'           -> todos (estado null)
 *  - un estado valido     -> ese estado
 *  - cualquier otra cosa  -> lista VACIA. La categoria 'esports' del frontend
 *    llega hasta aqui; ignorar el filtro y mostrar todos los partidos seria lo
 *    contrario de lo que se pidio (misma regla de encuentro.rutas.js).
 *
 * @returns {{ vacio: boolean, estado: string|null }}
 */
export function filtroDeEstado(estado) {
  const valor = String(estado ?? '').trim();
  if (valor === '' || valor === 'all') return { vacio: false, estado: null };
  if (ESTADOS_ENCUENTRO.includes(valor)) return { vacio: false, estado: valor };
  return { vacio: true, estado: null };
}

/** Entero positivo o null. Un filtro opcional en 0 o ausente es "sin filtro". */
export function idPositivo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Limite de ListarEncuentros: ausente o <= 0 = sin limite; nunca mas de LIMITE_MAXIMO. */
export function limiteListado(limite) {
  const n = idPositivo(limite);
  return n === null ? null : Math.min(n, LIMITE_MAXIMO);
}

/** Limite de ListarDestacados: 0 = el valor por defecto del servicio (4). */
export function limiteDestacados(limite) {
  const n = idPositivo(limite);
  return n === null ? LIMITE_DESTACADOS : Math.min(n, LIMITE_MAXIMO);
}

/** Ids para hidratar: enteros positivos y sin repetidos. Lista vacia = nada que buscar. */
export function idsValidos(ids) {
  const unicos = [...new Set((ids ?? []).map(idPositivo).filter((id) => id !== null))];
  if (unicos.length > MAX_IDS) {
    throw invalido(`Se pueden consultar máximo ${MAX_IDS} partidos a la vez`);
  }
  return unicos;
}
