/**
 * Filas de ejemplo (con la forma EXACTA que devuelve mysql2) y repositorios
 * falsos en memoria para probar servicio y handlers sin MySQL.
 *
 * node --test ejecuta todo .js bajo test/, asi que este modulo NO tiene efectos
 * al importarse: solo exporta funciones.
 */

/** Fila de SELECT_ENCUENTRO: por defecto, el encuentro 1 (MIL 1-0 NAL, en vivo). */
export function filaEncuentro(cambios = {}) {
  return {
    id_encuentro: 1,
    estado: 'live',
    fecha_hora: new Date('2026-11-09T19:00:00.000Z'),
    minuto: 67,
    destacado: 1,
    arbitro: 'Wilmar Roldán',
    estadio: 'El Campín',
    id_jornada: 2,
    numero_jornada: 2,
    id_torneo: 1,
    torneo_nombre: 'Liga BetPlay',
    torneo_accent: '#e7c566',
    torneo_pais: 'Colombia',
    torneo_temporada: '2026-II',
    local_id: 1,
    local_torneo: 1,
    local_nombre: 'Millonarios',
    local_codigo: 'MIL',
    local_seed: 0,
    local_fundacion: '1946-06-18',
    local_ciudad: 'Bogotá',
    local_goles: 1,
    visita_id: 2,
    visita_torneo: 1,
    visita_nombre: 'Atlético Nacional',
    visita_codigo: 'NAL',
    visita_seed: 1,
    visita_fundacion: '1947-03-07',
    visita_ciudad: 'Medellín',
    visita_goles: 0,
    ...cambios,
  };
}

/** El encuentro 5 (AME - JUN): proximo, sin marcador, sin minuto, sin estadistica. */
export function filaProximo(cambios = {}) {
  return filaEncuentro({
    id_encuentro: 5,
    estado: 'upcoming',
    fecha_hora: new Date('2026-11-10T00:30:00.000Z'),
    minuto: null,
    destacado: 0,
    arbitro: 'Andrés Rojas',
    estadio: 'Pascual Guerrero',
    local_id: 3,
    local_nombre: 'América de Cali',
    local_codigo: 'AME',
    local_seed: 2,
    local_ciudad: 'Cali',
    local_goles: null,
    visita_id: 4,
    visita_nombre: 'Junior',
    visita_codigo: 'JUN',
    visita_seed: 0,
    visita_ciudad: 'Barranquilla',
    visita_goles: null,
    ...cambios,
  });
}

export const FILAS_COLOR = [
  { id_equipo: 1, rol_color: 'PRIMARY', valor_hex: '#123a8f' },
  { id_equipo: 1, rol_color: 'SECONDARY', valor_hex: '#ffffff' },
  { id_equipo: 3, rol_color: 'PRIMARY', valor_hex: '#c8102e' },
  // el 2 y el 4 no tienen colores: deben salir los de defecto
];

export const FILA_ESTADISTICA = {
  posesion_local: '58.00',
  posesion_visitante: '42.00',
  tiros_local: 12,
  tiros_visitante: 7,
  tiros_arco_local: 5,
  tiros_arco_visitante: 2,
  faltas_local: 9,
  faltas_visitante: 13,
  corners_local: 6,
  corners_visitante: null, // un lado sin registrar
};

export const FILAS_ALINEACION = [
  {
    es_titular: 1,
    posicion: 'DELANTERO',
    id_jugador: 3,
    id_equipo: 1,
    nombres: 'Santiago',
    apellidos: 'Bermúdez',
    dorsal: 9,
    goles: 1,
    asistencias: 0,
    minutos_jugados: 67,
  },
  {
    es_titular: 0,
    posicion: 'DEFENSA',
    id_jugador: 5,
    id_equipo: 2,
    nombres: 'Mateo',
    apellidos: 'Cardona',
    dorsal: null,
    goles: 0,
    asistencias: 0,
    minutos_jugados: null,
  },
];

const FILA_EQUIPO = {
  id_equipo: 1,
  id_torneo: 1,
  equipo_nombre: 'Millonarios',
  equipo_codigo: 'MIL',
  crest_seed: 0,
  fundacion: '1946-06-18',
  equipo_ciudad: 'Bogotá',
  torneo_nombre: 'Liga BetPlay',
  torneo_accent: '#e7c566',
  torneo_pais: 'Colombia',
  torneo_temporada: '2026-II',
};

const FILAS_JORNADA = [
  {
    id_jornada: 2,
    numero_jornada: 2,
    fecha_inicio: '2026-11-08',
    fecha_fin: '2026-11-14',
    temporada: '2026-II',
    id_torneo: 1,
    torneo_nombre: 'Liga BetPlay',
    torneo_accent: '#e7c566',
    torneo_pais: 'Colombia',
  },
  {
    id_jornada: 1,
    numero_jornada: 1,
    fecha_inicio: '2026-11-01',
    fecha_fin: '2026-11-07',
    temporada: '2026-II',
    id_torneo: 1,
    torneo_nombre: 'Liga BetPlay',
    torneo_accent: '#e7c566',
    torneo_pais: 'Colombia',
  },
];

/**
 * Repositorios falsos con los encuentros 1 (en vivo, con estadistica) y 5
 * (proximo). `llamadas` registra cada metodo invocado con sus argumentos.
 */
export function crearReposFalsos() {
  const llamadas = [];
  const anotar = (metodo, ...args) => llamadas.push({ metodo, args });
  const encuentros = [filaEncuentro(), filaProximo()];

  const catalogoRepo = {
    async listarTorneos() {
      anotar('listarTorneos');
      return [{ id_torneo: 2, nombre: 'Copa Libertadores', accent_hex: '#3b82f6', pais: 'CONMEBOL', temporada: '2026' }];
    },
    async listarEquipos(filtros) {
      anotar('listarEquipos', filtros);
      return [FILA_EQUIPO];
    },
    async buscarEquipoPorId(id) {
      anotar('buscarEquipoPorId', id);
      return id === 1 ? FILA_EQUIPO : null;
    },
    async coloresDeEquipos(ids) {
      anotar('coloresDeEquipos', ids);
      return FILAS_COLOR.filter((f) => ids.includes(f.id_equipo));
    },
    async listarJugadores(filtros) {
      anotar('listarJugadores', filtros);
      return [];
    },
    async listarEstadios() {
      anotar('listarEstadios');
      return [];
    },
  };

  const encuentroRepo = {
    async listar(filtros) {
      anotar('listar', filtros);
      return encuentros.filter((e) => !filtros.estado || e.estado === filtros.estado);
    },
    async listarDestacados(limite) {
      anotar('listarDestacados', limite);
      return encuentros.slice(0, limite);
    },
    async buscarPorId(id) {
      anotar('buscarPorId', id);
      return encuentros.find((e) => e.id_encuentro === id) ?? null;
    },
    async buscarPorIds(ids) {
      anotar('buscarPorIds', ids);
      return encuentros.filter((e) => ids.includes(e.id_encuentro));
    },
    async deJornadas(ids) {
      anotar('deJornadas', ids);
      return encuentros.filter((e) => ids.includes(e.id_jornada));
    },
    async estadistica(id) {
      anotar('estadistica', id);
      return id === 1 ? FILA_ESTADISTICA : null;
    },
    async alineacion(id) {
      anotar('alineacion', id);
      return id === 1 ? FILAS_ALINEACION : [];
    },
    /** Como el real: le pasa la fila actual a `resolver` y, si no lanza, la modifica. */
    async actualizarEstado(id, resolver) {
      anotar('actualizarEstado', id);
      const fila = encuentros.find((e) => e.id_encuentro === id);
      if (!fila) return false;
      const nuevo = resolver({
        estado: fila.estado,
        minuto: fila.minuto,
        local_goles: fila.local_goles,
        visita_goles: fila.visita_goles,
      });
      Object.assign(fila, {
        estado: nuevo.estado,
        minuto: nuevo.minuto,
        local_goles: nuevo.golesLocal,
        visita_goles: nuevo.golesVisitante,
      });
      return true;
    },
    async jornadas(filtros) {
      anotar('jornadas', filtros);
      return FILAS_JORNADA;
    },
  };

  return {
    catalogoRepo,
    encuentroRepo,
    llamadas,
    /** Las llamadas a un metodo, para afirmar cuantas veces y con que. */
    de: (metodo) => llamadas.filter((l) => l.metodo === metodo),
  };
}
