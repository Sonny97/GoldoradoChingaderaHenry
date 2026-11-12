/**
 * Implementacion del servicio gRPC `Deportes` (proto/deportes.proto).
 *
 * Los handlers TRADUCEN: sacan los campos del request, llaman al servicio y
 * envuelven la respuesta en el mensaje del contrato. No deciden nada (eso es de
 * servicios/) ni consultan (eso es de repositorios/), la misma regla de las
 * rutas del monolito.
 *
 * Los errores no se atrapan aqui: un ErrorNegocio (noEncontrado, invalido) llega
 * al cliente con su codigo gRPC y su mensaje en español; un error de MySQL lo
 * traduce crearServidorGrpc (conexion -> UNAVAILABLE) sin filtrar su texto.
 *
 * Deben existir TODOS los rpc del .proto o el servidor no arranca.
 */

export function crearHandlers({ servicio, salud }) {
  return {
    Salud: salud,

    async ListarTorneos() {
      return { torneos: await servicio.listarTorneos() };
    },

    async ListarEquipos(req) {
      return { equipos: await servicio.listarEquipos({ idTorneo: req.idTorneo }) };
    },

    async ObtenerEquipo(req) {
      return servicio.obtenerEquipo(req.id);
    },

    async ListarJugadores(req) {
      return { jugadores: await servicio.listarJugadores({ idEquipo: req.idEquipo }) };
    },

    async ListarEstadios() {
      return { estadios: await servicio.listarEstadios() };
    },

    async ListarEncuentros(req) {
      return {
        encuentros: await servicio.listarEncuentros({
          estado: req.estado,
          idTorneo: req.idTorneo,
          idEquipo: req.idEquipo,
          limite: req.limite,
        }),
      };
    },

    async ListarDestacados(req) {
      return { encuentros: await servicio.listarDestacados(req.limite) };
    },

    async ObtenerEncuentro(req) {
      return servicio.obtenerEncuentro(req.id);
    },

    async ObtenerDetalleEncuentro(req) {
      return servicio.obtenerDetalleEncuentro(req.id);
    },

    async ObtenerEncuentrosPorIds(req) {
      return { encuentros: await servicio.obtenerEncuentrosPorIds(req.ids) };
    },

    async ActualizarEncuentro(req) {
      return servicio.actualizarEncuentro({
        id: req.id,
        estado: req.estado,
        minuto: req.minuto,
        golesLocal: req.golesLocal,
        golesVisitante: req.golesVisitante,
      });
    },

    async ListarCalendario(req) {
      return {
        jornadas: await servicio.listarCalendario({
          idTorneo: req.idTorneo,
          numeroJornada: req.numeroJornada,
        }),
      };
    },
  };
}
