/**
 * Catalogos de solo lectura: torneos, equipos (y sus colores), jugadores y
 * estadios. Devuelve FILAS; la forma del contrato la pone servicios/mapeadores.js.
 *
 * En el monolito estos datos habian salido de src/data/*.js a la base para que
 * la pantalla y la base dijeran lo mismo; aqui siguen saliendo de la base, ahora
 * la de ms-deportes.
 */

/**
 * Temporada vigente de cada torneo = la ultima que empezo.
 *
 * En T-SQL era OUTER APPLY (SELECT TOP 1 ... ORDER BY fecha_inicio DESC). En
 * MySQL 8.0.14+ lo mismo se escribe LEFT JOIN LATERAL (... LIMIT 1) ON TRUE: la
 * subconsulta puede mirar a `t` de afuera. Con un JOIN normal a temporada saldria
 * una fila de torneo por cada temporada.
 */
const TEMPORADA_VIGENTE = `
    LEFT JOIN LATERAL (
        SELECT tp.etiqueta
        FROM temporada tp
        WHERE tp.id_torneo = t.id_torneo
        ORDER BY tp.fecha_inicio DESC
        LIMIT 1
    ) tm ON TRUE
`;

/**
 * `pais` sale de COALESCE(pais, confederacion): un torneo nacional muestra el
 * pais y uno continental la confederacion. Es la contrapartida de
 * CHK_Torneo_Ambito, que garantiza que siempre haya exactamente uno de los dos.
 */
const SELECT_EQUIPO = `
    SELECT
        e.id_equipo,
        e.id_torneo,
        e.nombre       AS equipo_nombre,
        e.codigo_corto AS equipo_codigo,
        e.crest_seed,
        e.fundacion,
        ci.nombre      AS equipo_ciudad,
        t.nombre       AS torneo_nombre,
        t.accent_hex   AS torneo_accent,
        COALESCE(p.nombre, t.confederacion) AS torneo_pais,
        tm.etiqueta    AS torneo_temporada
    FROM equipo e
    JOIN ciudad ci   ON ci.id_ciudad  = e.id_ciudad
    JOIN torneo t    ON t.id_torneo   = e.id_torneo
    LEFT JOIN pais p ON p.codigo_iso  = t.codigo_pais
    ${TEMPORADA_VIGENTE}
`;

export function crearCatalogoRepo({ pool }) {
  async function consultar(sql, parametros = []) {
    const [filas] = await pool.query(sql, parametros);
    return filas;
  }

  return {
    listarTorneos() {
      return consultar(`
        SELECT
            t.id_torneo,
            t.nombre,
            t.accent_hex,
            COALESCE(p.nombre, t.confederacion) AS pais,
            tm.etiqueta AS temporada
        FROM torneo t
        LEFT JOIN pais p ON p.codigo_iso = t.codigo_pais
        ${TEMPORADA_VIGENTE}
        ORDER BY t.id_torneo
      `);
    },

    /** Equipos, opcionalmente de un torneo. */
    listarEquipos({ idTorneo = null } = {}) {
      if (idTorneo) {
        return consultar(`${SELECT_EQUIPO} WHERE e.id_torneo = ? ORDER BY t.id_torneo, e.nombre`, [Number(idTorneo)]);
      }
      return consultar(`${SELECT_EQUIPO} ORDER BY t.id_torneo, e.nombre`);
    },

    /** Un equipo por id (el monolito traia los 16 y buscaba en memoria). */
    async buscarEquipoPorId(idEquipo) {
      const filas = await consultar(`${SELECT_EQUIPO} WHERE e.id_equipo = ?`, [Number(idEquipo)]);
      return filas[0] ?? null;
    },

    /**
     * Colores de un conjunto de equipos en UNA consulta. No va como JOIN porque
     * son dos filas por equipo (4FN) y el JOIN duplicaria cada equipo; una
     * consulta por equipo seria el problema N+1. El agrupado se hace en memoria.
     */
    coloresDeEquipos(idsEquipo) {
      if (!idsEquipo?.length) return Promise.resolve([]);
      return consultar('SELECT id_equipo, rol_color, valor_hex FROM equipo_color WHERE id_equipo IN (?)', [
        [...new Set(idsEquipo)],
      ]);
    },

    /**
     * Jugadores con el nombre de su equipo. Los que no tienen dorsal van al
     * final: en MySQL los NULL quedan PRIMERO en un ORDER BY ascendente, de ahi
     * el `dorsal IS NULL` antes del dorsal.
     */
    listarJugadores({ idEquipo = null } = {}) {
      const where = idEquipo ? 'WHERE ju.id_equipo = ?' : '';
      return consultar(
        `SELECT
             ju.id_jugador,
             ju.id_equipo,
             ju.nombres,
             ju.apellidos,
             ju.posicion,
             ju.dorsal,
             ju.fecha_nacimiento,
             ju.activo,
             pn.nombre AS pais_nacimiento,
             e.nombre  AS equipo_nombre
         FROM jugador ju
         JOIN equipo e     ON e.id_equipo   = ju.id_equipo
         LEFT JOIN pais pn ON pn.codigo_iso = ju.codigo_pais_nac
         ${where}
         ORDER BY ju.id_equipo, ju.dorsal IS NULL, ju.dorsal, ju.apellidos`,
        idEquipo ? [Number(idEquipo)] : []
      );
    },

    /** Estadios con su ciudad y su pais (la jerarquia pais -> region -> ciudad). */
    listarEstadios() {
      return consultar(`
        SELECT
            es.id_estadio,
            es.nombre,
            es.capacidad,
            ci.nombre AS ciudad,
            p.nombre  AS pais
        FROM estadio es
        JOIN ciudad ci ON ci.id_ciudad  = es.id_ciudad
        JOIN region r  ON r.id_region   = ci.id_region
        JOIN pais   p  ON p.codigo_iso  = r.codigo_pais
        ORDER BY p.nombre, ci.nombre, es.nombre
      `);
    },
  };
}
