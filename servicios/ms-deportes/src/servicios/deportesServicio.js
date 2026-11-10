/**
 * Reglas de negocio de ms-deportes: que se consulta, que se valida y cuando se
 * responde "no encontrado". No escribe SQL (eso es de los repositorios) ni sabe
 * de gRPC (eso es de grpc/handlers.js).
 *
 * Es una fabrica con los repositorios inyectados: las pruebas le pasan repos
 * falsos en memoria y no necesitan MySQL.
 *
 * Los colores de los equipos se piden SIEMPRE en una sola consulta IN (...) por
 * respuesta y se agrupan en memoria: nunca una consulta por equipo (N+1).
 */

import { invalido, noEncontrado } from '@goldorado/comun';

import * as mapear from './mapeadores.js';
import { filtroDeEstado, idPositivo, idsValidos, limiteDestacados, limiteListado } from './reglas.js';

export function crearServicioDeportes({ catalogoRepo, encuentroRepo }) {
  /** Colores de todos los equipos que aparecen en las filas, de una sola vez. */
  async function coloresDeEncuentros(filas) {
    if (filas.length === 0) return new Map();
    return mapear.mapaDeColores(await catalogoRepo.coloresDeEquipos(mapear.idsDeEquipos(filas)));
  }

  /** Completa las filas crudas con colores y les da la forma del contrato. */
  async function hidratar(filas) {
    if (filas.length === 0) return [];
    const colores = await coloresDeEncuentros(filas);
    return filas.map((fila) => mapear.aEncuentro(fila, colores));
  }

  /** Mismo mensaje del monolito para un id que no es entero positivo. */
  function exigirId(valor, mensaje) {
    const id = idPositivo(valor);
    if (id === null) throw invalido(mensaje);
    return id;
  }

  async function obtenerEncuentro(id) {
    const idEncuentro = exigirId(id, 'Identificador de partido inválido');
    const fila = await encuentroRepo.buscarPorId(idEncuentro);
    if (!fila) throw noEncontrado('Partido no encontrado');
    const [encuentro] = await hidratar([fila]);
    return encuentro;
  }

  return {
    async listarTorneos() {
      const filas = await catalogoRepo.listarTorneos();
      return filas.map(mapear.aTorneo);
    },

    async listarEquipos({ idTorneo } = {}) {
      const filas = await catalogoRepo.listarEquipos({ idTorneo: idPositivo(idTorneo) });
      if (filas.length === 0) return [];
      const colores = mapear.mapaDeColores(await catalogoRepo.coloresDeEquipos(filas.map((f) => Number(f.id_equipo))));
      return filas.map((fila) => mapear.aEquipo(fila, colores));
    },

    async obtenerEquipo(id) {
      const idEquipo = exigirId(id, 'Identificador de equipo inválido');
      const fila = await catalogoRepo.buscarEquipoPorId(idEquipo);
      if (!fila) throw noEncontrado('Equipo no encontrado');
      const colores = mapear.mapaDeColores(await catalogoRepo.coloresDeEquipos([idEquipo]));
      return mapear.aEquipo(fila, colores);
    },

    async listarJugadores({ idEquipo } = {}) {
      const filas = await catalogoRepo.listarJugadores({ idEquipo: idPositivo(idEquipo) });
      return filas.map(mapear.aJugador);
    },

    async listarEstadios() {
      const filas = await catalogoRepo.listarEstadios();
      return filas.map(mapear.aEstadio);
    },

    /**
     * Un estado que no existe ('esports') devuelve la lista vacia SIN consultar:
     * no es un error, es una categoria que todavia no tiene partidos.
     */
    async listarEncuentros({ estado, idTorneo, idEquipo, limite } = {}) {
      const filtro = filtroDeEstado(estado);
      if (filtro.vacio) return [];

      const filas = await encuentroRepo.listar({
        estado: filtro.estado,
        idTorneo: idPositivo(idTorneo),
        idEquipo: idPositivo(idEquipo),
        limite: limiteListado(limite),
      });
      return hidratar(filas);
    },

    async listarDestacados(limite) {
      return hidratar(await encuentroRepo.listarDestacados(limiteDestacados(limite)));
    },

    obtenerEncuentro,

    /**
     * Detalle ampliado: estadistica de equipos y alineaciones. Solo lo pide la
     * pantalla de detalle; por eso no va en el listado.
     */
    async obtenerDetalleEncuentro(id) {
      const encuentro = await obtenerEncuentro(id);
      const [estadistica, alineacion] = await Promise.all([
        encuentroRepo.estadistica(encuentro.id),
        encuentroRepo.alineacion(encuentro.id),
      ]);
      return {
        encuentro,
        estadisticas: mapear.aEstadisticas(estadistica),
        alineacion: alineacion.map(mapear.aJugadorAlineado),
      };
    },

    /** Para hidratar el historial de apuestas: los ids que no existen no vienen. */
    async obtenerEncuentrosPorIds(ids) {
      const validos = idsValidos(ids);
      if (validos.length === 0) return [];
      return hidratar(await encuentroRepo.buscarPorIds(validos));
    },

    /**
     * Calendario: jornadas y sus encuentros con 3 consultas en total (jornadas,
     * encuentros de TODAS esas jornadas, colores), agrupadas en memoria.
     */
    async listarCalendario({ idTorneo, numeroJornada } = {}) {
      const jornadas = await encuentroRepo.jornadas({
        idTorneo: idPositivo(idTorneo),
        numeroJornada: idPositivo(numeroJornada),
      });
      if (jornadas.length === 0) return [];

      const filas = await encuentroRepo.deJornadas(jornadas.map((j) => Number(j.id_jornada)));
      const colores = await coloresDeEncuentros(filas);

      const porJornada = new Map();
      for (const fila of filas) {
        const idJornada = Number(fila.id_jornada);
        const lista = porJornada.get(idJornada) ?? [];
        lista.push(mapear.aEncuentro(fila, colores));
        porJornada.set(idJornada, lista);
      }

      return jornadas.map((j) => mapear.aJornadaCalendario(j, porJornada.get(Number(j.id_jornada)) ?? []));
    },
  };
}
