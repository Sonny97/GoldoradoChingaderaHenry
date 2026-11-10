/**
 * Encuentros con sus dos equipos y su torneo. Las cuotas ya NO van aqui: son de
 * ms-apuestas y el BFF las une a la tarjeta del partido.
 *
 * ESTA ES LA CONSULTA QUE MEJOR MUESTRA EL MODELO (igual que en el monolito).
 * Un encuentro no guarda id_equipo_local ni id_equipo_visitante: guarda DOS
 * filas en encuentro_equipo con el mismo id_encuentro y un `rol` distinto. Para
 * volver a armar el partido hay que unir encuentro_equipo y equipo DOS VECES,
 * con alias distintos (loc_ / vis_) y filtrando el rol EN EL ON. Ese doble JOIN
 * a la misma tabla es la respuesta a "¿cual de los dos id_equipo se une a
 * equipo?": los dos.
 *
 * El repositorio devuelve FILAS; darles la forma del contrato gRPC es trabajo de
 * servicios/mapeadores.js. Recibe el pool por parametro para que las pruebas no
 * necesiten MySQL. Todo valor externo viaja como `?` (mysql2 lo escapa; un
 * arreglo en `IN (?)` se expande a la lista).
 */

/**
 * SELECT completo del encuentro.
 *
 * estadio va con LEFT JOIN porque encuentro.id_estadio es NULLABLE (partido sin
 * sede confirmada); pais tambien, porque un torneo continental no tiene pais.
 */
export const SELECT_ENCUENTRO = `
    SELECT
        e.id_encuentro,
        e.estado,
        e.fecha_hora,
        e.minuto,
        e.destacado,
        e.arbitro,
        es.nombre AS estadio,
        j.id_jornada,
        j.numero_jornada,

        t.id_torneo,
        t.nombre     AS torneo_nombre,
        t.accent_hex AS torneo_accent,
        COALESCE(p.nombre, t.confederacion) AS torneo_pais,
        tm.etiqueta  AS torneo_temporada,

        -- ---- participacion LOCAL
        loc_eq.id_equipo    AS local_id,
        loc_eq.id_torneo    AS local_torneo,
        loc_eq.nombre       AS local_nombre,
        loc_eq.codigo_corto AS local_codigo,
        loc_eq.crest_seed   AS local_seed,
        loc_eq.fundacion    AS local_fundacion,
        loc_ci.nombre       AS local_ciudad,
        loc_ee.goles        AS local_goles,

        -- ---- participacion VISITANTE (misma tabla equipo, otro alias)
        vis_eq.id_equipo    AS visita_id,
        vis_eq.id_torneo    AS visita_torneo,
        vis_eq.nombre       AS visita_nombre,
        vis_eq.codigo_corto AS visita_codigo,
        vis_eq.crest_seed   AS visita_seed,
        vis_eq.fundacion    AS visita_fundacion,
        vis_ci.nombre       AS visita_ciudad,
        vis_ee.goles        AS visita_goles

    FROM encuentro e
    JOIN jornada   j  ON j.id_jornada    = e.id_jornada
    JOIN temporada tm ON tm.id_temporada = j.id_temporada
    JOIN torneo    t  ON t.id_torneo     = tm.id_torneo
    LEFT JOIN pais    p  ON p.codigo_iso  = t.codigo_pais
    LEFT JOIN estadio es ON es.id_estadio = e.id_estadio

    JOIN encuentro_equipo loc_ee ON loc_ee.id_encuentro = e.id_encuentro AND loc_ee.rol = 'LOCAL'
    JOIN equipo           loc_eq ON loc_eq.id_equipo    = loc_ee.id_equipo
    JOIN ciudad           loc_ci ON loc_ci.id_ciudad    = loc_eq.id_ciudad

    JOIN encuentro_equipo vis_ee ON vis_ee.id_encuentro = e.id_encuentro AND vis_ee.rol = 'VISITANTE'
    JOIN equipo           vis_eq ON vis_eq.id_equipo    = vis_ee.id_equipo
    JOIN ciudad           vis_ci ON vis_ci.id_ciudad    = vis_eq.id_ciudad
`;

/**
 * Orden de relevancia: primero lo que esta pasando, despues lo que viene, luego
 * lo que ya termino y al final lo cancelado; dentro de cada grupo, por kickoff.
 * Los estados son los de CHK_Encuentro_Estado y los de ESTADOS_ENCUENTRO en
 * servicios/reglas.js (una prueba vigila que no se desalineen).
 */
const CASE_RELEVANCIA = `
        CASE e.estado
            WHEN 'live'     THEN 0
            WHEN 'upcoming' THEN 1
            WHEN 'finished' THEN 2
            WHEN 'canceled' THEN 3
            ELSE 4
        END`;

export const ORDEN_RELEVANCIA = `
    ORDER BY ${CASE_RELEVANCIA},
        e.fecha_hora, e.id_encuentro
`;

/** La home: destacados primero y, entre ellos, por relevancia. */
export const ORDEN_DESTACADOS = `
    ORDER BY
        e.destacado DESC, ${CASE_RELEVANCIA},
        e.fecha_hora, e.id_encuentro
`;

/**
 * Arma el listado con filtros opcionales. Funcion pura (sin pool) para poder
 * probar el SQL que sale sin tener MySQL.
 *
 * `estado` llega ya validado por el servicio: null = todos.
 *
 * El filtro por equipo NO se escribe como (loc_eq.id_equipo = ? OR
 * vis_eq.id_equipo = ?), que era lo del monolito: un OR entre columnas de dos
 * alias obliga a armar todos los partidos y filtrar al final. El semi-join por
 * encuentro_equipo entra por IX_EncuentroEquipo_Equipo y sirve para los dos roles.
 *
 * LIMIT ? exige un NUMERO: con una cadena mysql2 escribiria LIMIT '4', que es
 * error de sintaxis. (En T-SQL era TOP (@limite).)
 */
export function consultaListado({ estado = null, idTorneo = null, idEquipo = null, limite = null, destacadosPrimero = false } = {}) {
  const condiciones = [];
  const parametros = [];

  if (estado) {
    condiciones.push('e.estado = ?');
    parametros.push(estado);
  }
  if (idTorneo) {
    condiciones.push('t.id_torneo = ?');
    parametros.push(Number(idTorneo));
  }
  if (idEquipo) {
    condiciones.push('e.id_encuentro IN (SELECT ee.id_encuentro FROM encuentro_equipo ee WHERE ee.id_equipo = ?)');
    parametros.push(Number(idEquipo));
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const orden = destacadosPrimero ? ORDEN_DESTACADOS : ORDEN_RELEVANCIA;

  let limitar = '';
  if (limite) {
    limitar = 'LIMIT ?';
    parametros.push(Number(limite));
  }

  return { sql: `${SELECT_ENCUENTRO} ${where} ${orden} ${limitar}`, parametros };
}

export function crearEncuentroRepo({ pool }) {
  async function consultar(sql, parametros = []) {
    const [filas] = await pool.query(sql, parametros);
    return filas;
  }

  return {
    /** Listado con filtros (todos opcionales). */
    listar(filtros = {}) {
      const { sql, parametros } = consultaListado(filtros);
      return consultar(sql, parametros);
    },

    listarDestacados(limite) {
      const { sql, parametros } = consultaListado({ limite, destacadosPrimero: true });
      return consultar(sql, parametros);
    },

    async buscarPorId(idEncuentro) {
      const filas = await consultar(`${SELECT_ENCUENTRO} WHERE e.id_encuentro = ?`, [Number(idEncuentro)]);
      return filas[0] ?? null;
    },

    /** Varios de una vez; los que no existen simplemente no vuelven. */
    buscarPorIds(idsEncuentro) {
      if (!idsEncuentro?.length) return Promise.resolve([]);
      return consultar(`${SELECT_ENCUENTRO} WHERE e.id_encuentro IN (?) ${ORDEN_RELEVANCIA}`, [idsEncuentro]);
    },

    /** Los encuentros de un conjunto de jornadas (calendario), en una sola consulta. */
    deJornadas(idsJornada) {
      if (!idsJornada?.length) return Promise.resolve([]);
      return consultar(`${SELECT_ENCUENTRO} WHERE e.id_jornada IN (?) ORDER BY e.fecha_hora, e.id_encuentro`, [
        idsJornada,
      ]);
    },

    /** Estadistica de equipo (1 a 1 con el encuentro): null si el partido no tiene. */
    async estadistica(idEncuentro) {
      const filas = await consultar(
        `SELECT posesion_local, posesion_visitante,
                tiros_local, tiros_visitante,
                tiros_arco_local, tiros_arco_visitante,
                faltas_local, faltas_visitante,
                corners_local, corners_visitante
         FROM estadistica_encuentro
         WHERE id_encuentro = ?`,
        [Number(idEncuentro)]
      );
      return filas[0] ?? null;
    },

    /**
     * Alineacion con la estadistica individual. LEFT JOIN: un jugador alineado
     * sin estadistica cargada sigue apareciendo, con 0 goles y 0 asistencias.
     * ISNULL(x, 0) de T-SQL no existe en MySQL (alli ISNULL(x) solo pregunta si
     * es NULL): se usa COALESCE, que es estandar.
     */
    alineacion(idEncuentro) {
      return consultar(
        `SELECT
             a.es_titular,
             COALESCE(a.posicion_juego, ju.posicion) AS posicion,
             ju.id_jugador,
             ju.id_equipo,
             ju.nombres,
             ju.apellidos,
             ju.dorsal,
             COALESCE(ej.goles, 0)       AS goles,
             COALESCE(ej.asistencias, 0) AS asistencias,
             ej.minutos_jugados
         FROM alineacion a
         JOIN jugador ju ON ju.id_jugador = a.id_jugador
         LEFT JOIN estadistica_jugador_encuentro ej
                ON ej.id_encuentro = a.id_encuentro
               AND ej.id_jugador   = a.id_jugador
         WHERE a.id_encuentro = ?
         ORDER BY ju.id_equipo, ju.dorsal IS NULL, ju.dorsal`,
        [Number(idEncuentro)]
      );
    },

    /** Jornadas del calendario con su temporada y torneo. */
    jornadas({ idTorneo = null, numeroJornada = null } = {}) {
      const condiciones = [];
      const parametros = [];
      if (idTorneo) {
        condiciones.push('t.id_torneo = ?');
        parametros.push(Number(idTorneo));
      }
      if (numeroJornada) {
        condiciones.push('j.numero_jornada = ?');
        parametros.push(Number(numeroJornada));
      }
      const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

      return consultar(
        `SELECT
             j.id_jornada,
             j.numero_jornada,
             j.fecha_inicio,
             j.fecha_fin,
             tm.etiqueta  AS temporada,
             t.id_torneo,
             t.nombre     AS torneo_nombre,
             t.accent_hex AS torneo_accent,
             COALESCE(p.nombre, t.confederacion) AS torneo_pais
         FROM jornada j
         JOIN temporada tm ON tm.id_temporada = j.id_temporada
         JOIN torneo    t  ON t.id_torneo     = tm.id_torneo
         LEFT JOIN pais p  ON p.codigo_iso    = t.codigo_pais
         ${where}
         ORDER BY t.id_torneo, tm.fecha_inicio, j.numero_jornada`,
        parametros
      );
    },
  };
}
