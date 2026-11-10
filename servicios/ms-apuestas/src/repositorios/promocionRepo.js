/**
 * Promociones y los torneos a los que aplican.
 *
 * La relacion promo-torneo es N a N. El monolito traia los torneos en una
 * segunda consulta y los agrupaba en memoria, porque con un JOIN plano la promo
 * que "aplica a todas las ligas" saldria cuatro veces. Aqui lo resuelve
 * PostgreSQL en la misma consulta: array_agg dentro de un LEFT JOIN LATERAL
 * devuelve UNA fila por promocion con sus ids de torneo en un arreglo.
 *
 * Los nombres de los torneos viven en MySQL: el BFF los pone con ms-deportes.
 */

import { aFechaIso } from '@goldorado/comun';

const SELECT_PROMOCION = `
  SELECT p.id_promocion, p.titulo, p.subtitulo, p.descripcion,
         p.badge, p.cta_label, p.accent, p.destacada, p.fecha_expira,
         COALESCE(t.ids_torneo, '{}') AS ids_torneo
    FROM promocion p
    LEFT JOIN LATERAL (
         SELECT array_agg(pt.id_torneo ORDER BY pt.id_torneo) AS ids_torneo
           FROM promocion_torneo pt
          WHERE pt.id_promocion = p.id_promocion
    ) t ON true`;

/** Fila -> forma del mensaje Promocion. */
export function aPromocion(fila) {
  return {
    id: Number(fila.id_promocion),
    titulo: fila.titulo,
    subtitulo: fila.subtitulo ?? '',
    descripcion: fila.descripcion ?? '',
    badge: fila.badge ?? '',
    ctaLabel: fila.cta_label ?? '',
    acento: fila.accent ?? '',
    destacada: Boolean(fila.destacada),
    fechaExpira: aFechaIso(fila.fecha_expira),
    idsTorneo: (fila.ids_torneo ?? []).map(Number),
  };
}

/** @param {{ consultar: Function }} db */
export function crearRepoPromociones({ consultar }) {
  /**
   * Promociones vigentes.
   *
   * El filtro es contra CURRENT_DATE de la base y no contra una fecha calculada
   * en Node: la vigencia depende del reloj del servidor de base de datos, que
   * es uno solo, y no del de cada maquina que corra el servicio.
   * LIMIT NULL en PostgreSQL es "sin limite", asi que el parametro siempre va.
   */
  async function listarVigentes({ limite = null, excluirDestacada = false } = {}) {
    const { rows } = await consultar(
      `${SELECT_PROMOCION}
       WHERE p.fecha_expira >= CURRENT_DATE
         AND (NOT $1::boolean OR NOT p.destacada)
       ORDER BY p.destacada DESC, p.fecha_expira, p.id_promocion
       LIMIT $2`,
      [Boolean(excluirDestacada), limite]
    );
    return rows.map(aPromocion);
  }

  /** La promo del banner. Si no hay ninguna marcada, cae a la primera vigente. */
  async function destacada() {
    const [promocion] = await listarVigentes({ limite: 1 });
    return promocion ?? null;
  }

  /** Por id, vigente o no (igual que el monolito: el detalle de una promo vencida se puede abrir). */
  async function porId(idPromocion) {
    const { rows } = await consultar(`${SELECT_PROMOCION} WHERE p.id_promocion = $1`, [idPromocion]);
    return rows[0] ? aPromocion(rows[0]) : null;
  }

  return { listarVigentes, destacada, porId };
}
