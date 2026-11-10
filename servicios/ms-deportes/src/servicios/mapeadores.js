/**
 * Fila de MySQL -> mensaje del contrato (proto/deportes.proto).
 *
 * Funciones puras: son lo que mas se prueba, porque aqui se decide la diferencia
 * entre "no hay dato" y "el dato es cero":
 *  - goles NULL  -> golesLocal/golesVisitante AUSENTES. Un partido que no ha
 *    empezado no va 0-0, simplemente no tiene marcador (mismo criterio de
 *    encuentro_equipo.goles NULL en la base).
 *  - minuto solo viaja si el partido esta en vivo.
 *  - Un `optional` se omite dejandolo en undefined: proto-loader no lo envia y
 *    el BFF lo recibe como ausente, no como 0 o ''.
 * Los nombres de campo van en camelCase (keepCase:false en proto-loader).
 */

import { aFechaHoraIso, aFechaIso, aNumero } from '@goldorado/comun';

/** Los mismos colores que usaba el monolito cuando un equipo no tenia colores. */
export const COLORES_POR_DEFECTO = Object.freeze({ primario: '#101b36', secundario: '#f4f6fb' });

/** NULL -> undefined (campo ausente). Nunca convierte NULL en 0. */
export function enteroOpcional(valor) {
  return valor === null || valor === undefined ? undefined : Number(valor);
}

export function textoOpcional(valor) {
  return valor === null || valor === undefined || valor === '' ? undefined : String(valor);
}

/** DECIMAL llega como cadena desde mysql2: '58.00' -> 58. */
export function decimalOpcional(valor) {
  return aNumero(valor) ?? undefined;
}

/** TINYINT(1) llega como 0/1. */
const esVerdadero = (valor) => Boolean(Number(valor));

/** Filas de equipo_color -> Map(id_equipo -> { primario, secundario }). */
export function mapaDeColores(filas) {
  const mapa = new Map();
  for (const fila of filas ?? []) {
    const id = Number(fila.id_equipo);
    const actual = mapa.get(id) ?? {};
    if (String(fila.rol_color).toUpperCase() === 'PRIMARY') actual.primario = fila.valor_hex;
    else actual.secundario = fila.valor_hex;
    mapa.set(id, actual);
  }
  return mapa;
}

/** Colores de un equipo; si falta uno de los dos, el de defecto (campo por campo). */
export function coloresDe(mapa, idEquipo) {
  const colores = mapa?.get(Number(idEquipo));
  return {
    primario: colores?.primario ?? COLORES_POR_DEFECTO.primario,
    secundario: colores?.secundario ?? COLORES_POR_DEFECTO.secundario,
  };
}

/** Ids de los dos equipos de cada fila de encuentro, sin repetir (para UNA consulta de colores). */
export function idsDeEquipos(filasEncuentro) {
  return [...new Set((filasEncuentro ?? []).flatMap((f) => [Number(f.local_id), Number(f.visita_id)]))];
}

function torneo(id, nombre, pais, temporada, acento) {
  return {
    id: Number(id),
    nombre: nombre ?? '',
    pais: pais ?? '',
    temporada: temporada ?? '',
    acento: acento ?? '',
  };
}

/** Fila de ListarTorneos. */
export function aTorneo(fila) {
  return torneo(fila.id_torneo, fila.nombre, fila.pais, fila.temporada, fila.accent_hex);
}

/** Torneo embebido en filas de equipo y de encuentro (columnas con prefijo torneo_). */
function torneoDeFila(fila) {
  return torneo(fila.id_torneo, fila.torneo_nombre, fila.torneo_pais, fila.torneo_temporada, fila.torneo_accent);
}

/** Fila de ListarEquipos / ObtenerEquipo: el equipo CON su torneo. */
export function aEquipo(fila, colores) {
  return {
    id: Number(fila.id_equipo),
    nombre: fila.equipo_nombre,
    codigoCorto: fila.equipo_codigo,
    ciudad: fila.equipo_ciudad ?? '',
    idTorneo: Number(fila.id_torneo),
    crestSeed: Number(fila.crest_seed ?? 0),
    colores: coloresDe(colores, fila.id_equipo),
    fundacion: textoOpcional(aFechaIso(fila.fundacion)),
    torneo: torneoDeFila(fila),
  };
}

/** Equipo de un encuentro, desde las columnas local_* o visita_*. Sin torneo: ya va en el encuentro. */
function equipoDeEncuentro(fila, prefijo, colores) {
  const id = Number(fila[`${prefijo}_id`]);
  return {
    id,
    nombre: fila[`${prefijo}_nombre`],
    codigoCorto: fila[`${prefijo}_codigo`],
    ciudad: fila[`${prefijo}_ciudad`] ?? '',
    idTorneo: Number(fila[`${prefijo}_torneo`] ?? fila.id_torneo),
    crestSeed: Number(fila[`${prefijo}_seed`] ?? 0),
    colores: coloresDe(colores, id),
    fundacion: textoOpcional(aFechaIso(fila[`${prefijo}_fundacion`])),
  };
}

/** Forma final del partido (la que antes armaba hydrate() de matchService, sin cuotas). */
export function aEncuentro(fila, colores) {
  const enVivo = fila.estado === 'live';
  return {
    id: Number(fila.id_encuentro),
    idTorneo: Number(fila.id_torneo),
    estado: fila.estado,
    minuto: enVivo ? enteroOpcional(fila.minuto) : undefined,
    fechaHora: aFechaHoraIso(fila.fecha_hora) ?? '',
    estadio: textoOpcional(fila.estadio),
    arbitro: textoOpcional(fila.arbitro),
    destacado: esVerdadero(fila.destacado),
    local: equipoDeEncuentro(fila, 'local', colores),
    visitante: equipoDeEncuentro(fila, 'visita', colores),
    golesLocal: enteroOpcional(fila.local_goles),
    golesVisitante: enteroOpcional(fila.visita_goles),
    torneo: torneoDeFila(fila),
    numeroJornada: Number(fila.numero_jornada ?? 0),
  };
}

function par(local, visitante) {
  return { local: decimalOpcional(local), visitante: decimalOpcional(visitante) };
}

/**
 * estadistica_encuentro -> EstadisticaEquipos. Sin fila (partido que no ha
 * empezado) el mensaje va AUSENTE, no lleno de ceros.
 */
export function aEstadisticas(fila) {
  if (!fila) return undefined;
  return {
    posesion: par(fila.posesion_local, fila.posesion_visitante),
    tiros: par(fila.tiros_local, fila.tiros_visitante),
    tirosArco: par(fila.tiros_arco_local, fila.tiros_arco_visitante),
    faltas: par(fila.faltas_local, fila.faltas_visitante),
    corners: par(fila.corners_local, fila.corners_visitante),
  };
}

export function aJugadorAlineado(fila) {
  return {
    id: Number(fila.id_jugador),
    idEquipo: Number(fila.id_equipo),
    nombre: `${fila.nombres ?? ''} ${fila.apellidos ?? ''}`.trim(),
    dorsal: enteroOpcional(fila.dorsal),
    posicion: fila.posicion ?? '',
    titular: esVerdadero(fila.es_titular),
    goles: Number(fila.goles ?? 0),
    asistencias: Number(fila.asistencias ?? 0),
    minutos: enteroOpcional(fila.minutos_jugados),
  };
}

export function aJugador(fila) {
  return {
    id: Number(fila.id_jugador),
    idEquipo: Number(fila.id_equipo),
    nombres: fila.nombres,
    apellidos: fila.apellidos,
    posicion: fila.posicion,
    dorsal: enteroOpcional(fila.dorsal),
    fechaNacimiento: aFechaIso(fila.fecha_nacimiento) ?? '',
    paisNacimiento: textoOpcional(fila.pais_nacimiento),
    activo: esVerdadero(fila.activo),
    equipo: fila.equipo_nombre ?? '',
  };
}

export function aEstadio(fila) {
  return {
    id: Number(fila.id_estadio),
    nombre: fila.nombre,
    ciudad: fila.ciudad ?? '',
    pais: fila.pais ?? '',
    capacidad: enteroOpcional(fila.capacidad),
  };
}

/** Jornada del calendario con sus encuentros ya mapeados. */
export function aJornadaCalendario(fila, encuentros = []) {
  return {
    idJornada: Number(fila.id_jornada),
    numero: Number(fila.numero_jornada),
    fechaInicio: aFechaIso(fila.fecha_inicio) ?? '',
    fechaFin: aFechaIso(fila.fecha_fin) ?? '',
    torneo: torneo(fila.id_torneo, fila.torneo_nombre, fila.torneo_pais, fila.temporada, fila.torneo_accent),
    temporada: fila.temporada ?? '',
    encuentros,
  };
}
