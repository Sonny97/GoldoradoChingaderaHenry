/**
 * Tabla de decision de la liquidacion: funcion PURA (sin base ni gRPC) que dice
 * en que termina una apuesta segun el resultado del partido. Se prueba sola con
 * node --test; el repositorio la llama por cada apuesta PENDIENTE.
 *
 * Mercados (opcion_mercado.codigo_mercado / codigo_corto):
 *   1X2           '1' gana el local, 'X' empate, '2' gana la visita
 *   AMBOS_ANOTAN  'GG' los dos marcaron (> 0), 'NG' al menos uno no marco
 *   OVER_UNDER    'O25' total de goles >= 3,   'U25' total <= 2
 * Partido cancelado -> ANULADA (se devuelve el monto), sea cual sea el mercado.
 */

export const ESTADOS_PARTIDO_LIQUIDABLES = Object.freeze(['finished', 'canceled']);

/**
 * @param {{ mercado: string, codigoCorto: string }} apuesta
 * @param {{ estado: string, golesLocal?: number, golesVisitante?: number }} partido
 * @returns {'GANADA'|'PERDIDA'|'ANULADA'|null} null = mercado desconocido (no se toca)
 */
export function decidirApuesta({ mercado, codigoCorto }, { estado, golesLocal, golesVisitante }) {
  if (estado === 'canceled') return 'ANULADA';

  const local = Number(golesLocal);
  const visita = Number(golesVisitante);
  const gana = (condicion) => (condicion ? 'GANADA' : 'PERDIDA');

  switch (`${mercado}:${codigoCorto}`) {
    case '1X2:1':
      return gana(local > visita);
    case '1X2:X':
      return gana(local === visita);
    case '1X2:2':
      return gana(local < visita);
    case 'AMBOS_ANOTAN:GG':
      return gana(local > 0 && visita > 0);
    case 'AMBOS_ANOTAN:NG':
      return gana(!(local > 0 && visita > 0));
    case 'OVER_UNDER:O25':
      return gana(local + visita >= 3);
    case 'OVER_UNDER:U25':
      return gana(local + visita <= 2);
    default:
      return null;
  }
}
