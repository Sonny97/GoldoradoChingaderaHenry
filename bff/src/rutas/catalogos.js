/**
 * Catalogos: /api/catalogos/*  (ms-deportes, MySQL; tipos de documento de
 * ms-autenticacion, SQL Server).
 *
 * Son listas que el frontend usa para pintar selects y escudos. Los escudos de
 * Drive son dato secundario: si ms-imagenes no responde, `crestUrl` va en null
 * y el frontend dibuja el escudo generado por CSS.
 */

import { Router } from 'express';

import { crearBuscadorImagenes } from '../agregadores/imagenes.js';
import { aTipoDocumento } from '../mapeadores/usuario.js';
import { aLeague, aPlayer, aStadium, aTeamConLiga } from '../mapeadores/deportes.js';
import { enviarError, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { enteroPositivo, opciones } from '../utils/contexto.js';

export function crearRutasCatalogos({ clientes, log }) {
  const router = Router();
  const imagenes = crearBuscadorImagenes({ clientes, log });
  const deportes = clientes.deportes;

  router.get(
    '/tipos-documento',
    asyncHandler(async (req, res) => {
      const { tipos = [] } = await clientes.autenticacion.ListarTiposDocumento({}, opciones(req));
      // CC primero: es la que elige 9 de cada 10 personas en Colombia.
      const ordenados = [...tipos].sort((a, b) => (a.codigo === 'CC' ? -1 : b.codigo === 'CC' ? 1 : 0));
      enviarOk(res, ordenados.map(aTipoDocumento));
    })
  );

  router.get(
    '/ligas',
    asyncHandler(async (req, res) => {
      const { torneos = [] } = await deportes.ListarTorneos({}, opciones(req));
      enviarOk(res, torneos.map(aLeague));
    })
  );

  router.get(
    '/equipos',
    asyncHandler(async (req, res) => {
      const { equipos = [] } = await deportes.ListarEquipos(
        { idTorneo: enteroPositivo(req.query.ligaId) },
        opciones(req)
      );
      const escudos = await imagenes.urlsPorEntidad('equipo', equipos.map((e) => e.id), req);
      enviarOk(res, equipos.map((e) => aTeamConLiga(e, escudos.get(String(e.id)))));
    })
  );

  router.get(
    '/equipos/:id',
    asyncHandler(async (req, res) => {
      const id = enteroPositivo(req.params.id);
      if (!id) return enviarError(res, 'Equipo no encontrado', 404);
      const equipo = await deportes.ObtenerEquipo({ id }, opciones(req));
      const escudos = await imagenes.urlsPorEntidad('equipo', [equipo.id], req);
      return enviarOk(res, aTeamConLiga(equipo, escudos.get(String(equipo.id))));
    })
  );

  router.get(
    '/jugadores',
    asyncHandler(async (req, res) => {
      const { jugadores = [] } = await deportes.ListarJugadores(
        { idEquipo: enteroPositivo(req.query.equipoId) },
        opciones(req)
      );
      enviarOk(res, jugadores.map(aPlayer));
    })
  );

  router.get(
    '/estadios',
    asyncHandler(async (req, res) => {
      const { estadios = [] } = await deportes.ListarEstadios({}, opciones(req));
      enviarOk(res, estadios.map(aStadium));
    })
  );

  return router;
}
