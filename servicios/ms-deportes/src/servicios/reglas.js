/**
 * Reglas puras de los filtros: que estado es valido, que limite se usa, que id
 * se acepta. Sin base y sin gRPC, para probarlas con node --test.
 *
 * La base sigue siendo la garantia (CHK_Encuentro_Estado); esto es la
 * comodidad de responder bien ANTES de consultar.
 */

import { invalido, precondicion } from '@goldorado/comun';

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

/** Entero >= 0 (goles) o null si no vino. Cualquier otra cosa es invalida. */
function enteroNoNegativo(valor, mensaje) {
  if (valor === null || valor === undefined) return null;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) throw invalido(mensaje);
  return n;
}

/**
 * ActualizarEncuentro, parte 1 (sin base): valida el request y lo normaliza.
 * Los campos `optional` del proto llegan undefined si no vienen.
 */
export function validarActualizacion({ estado, minuto, golesLocal, golesVisitante } = {}) {
  const nuevo = typeof estado === 'string' ? estado.trim().toLowerCase() : '';
  if (!ESTADOS_ENCUENTRO.includes(nuevo)) {
    throw invalido(`Estado inválido: debe ser uno de ${ESTADOS_ENCUENTRO.join(', ')}`);
  }

  const local = enteroNoNegativo(golesLocal, 'Los goles del local deben ser un entero mayor o igual a 0');
  const visita = enteroNoNegativo(golesVisitante, 'Los goles del visitante deben ser un entero mayor o igual a 0');

  let min = null;
  if (nuevo === 'live') {
    const n = Number(minuto);
    if (minuto === null || minuto === undefined || !Number.isInteger(n) || n < 0 || n > 130) {
      throw invalido('Un partido en vivo necesita el minuto (entero entre 0 y 130)');
    }
    min = n;
  }
  if (nuevo === 'finished' && (local === null || visita === null)) {
    throw invalido('Para finalizar el partido se necesitan los goles de los dos equipos');
  }

  return { estado: nuevo, minuto: min, golesLocal: local, golesVisitante: visita };
}

/**
 * ActualizarEncuentro, parte 2: con la fila ACTUAL (leida con bloqueo) decide
 * los valores que se escriben. Un partido terminado o cancelado ya no cambia.
 *  - live:     minuto 0..130; goles los que vengan o, si no, los actuales (0 si no habia)
 *  - upcoming: sin marcador y sin minuto
 *  - finished: goles obligatorios, minuto NULL
 *  - canceled: minuto NULL, conserva el marcador que tuviera
 */
export function resolverActualizacion(actual, pedido) {
  if (actual.estado === 'finished') throw precondicion('El partido ya terminó y no se puede modificar');
  if (actual.estado === 'canceled') throw precondicion('El partido fue cancelado y no se puede modificar');

  const golesActuales = (g) => (g === null || g === undefined ? null : Number(g));
  switch (pedido.estado) {
    case 'live':
      return {
        estado: 'live',
        minuto: pedido.minuto,
        golesLocal: pedido.golesLocal ?? golesActuales(actual.local_goles) ?? 0,
        golesVisitante: pedido.golesVisitante ?? golesActuales(actual.visita_goles) ?? 0,
      };
    case 'upcoming':
      return { estado: 'upcoming', minuto: null, golesLocal: null, golesVisitante: null };
    case 'finished':
      return { estado: 'finished', minuto: null, golesLocal: pedido.golesLocal, golesVisitante: pedido.golesVisitante };
    default: // canceled
      return {
        estado: 'canceled',
        minuto: null,
        golesLocal: golesActuales(actual.local_goles),
        golesVisitante: golesActuales(actual.visita_goles),
      };
  }
}
