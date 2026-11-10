/**
 * Partidos y calendario: /api/encuentros/*  y  /api/calendario.
 *
 * Cada `Match` junta tres servicios: el partido de ms-deportes (principal: si
 * falla, 503), las cuotas de ms-apuestas y los escudos de ms-imagenes
 * (secundarios: si fallan, `odds: []` y `crestUrl: null`). La hidratacion vive
 * en agregadores/encuentros.js para que lista, destacados, detalle y
 * calendario degraden exactamente igual.
 */

import { Router } from 'express';

import { crearHidratadorEncuentros } from '../agregadores/encuentros.js';
import { aJornada, aLineup, aStats } from '../mapeadores/deportes.js';
import { enviarError, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { enteroPositivo, limiteDe, opciones } from '../utils/contexto.js';

const ESTADOS_VALIDOS = new Set(['all', 'live', 'upcoming', 'finished', 'canceled']);

export function crearRutasEncuentros({ clientes, log }) {
  const router = Router();
  const { hidratar } = crearHidratadorEncuentros({ clientes, log });
  const deportes = clientes.deportes;

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : '';
      // La categoria 'esports' del frontend llega hasta aqui. No es un estado
      // valido, asi que se devuelve la lista vacia en vez de ignorar el filtro
      // y mostrar todos los partidos, que seria lo contrario de lo que pidio.
      if (estado && !ESTADOS_VALIDOS.has(estado)) return enviarOk(res, []);

      const { encuentros = [] } = await deportes.ListarEncuentros(
        {
          estado,
          idTorneo: enteroPositivo(req.query.ligaId),
          idEquipo: enteroPositivo(req.query.equipoId),
          limite: enteroPositivo(req.query.limite) ? limiteDe(req.query.limite, 50, 200) : undefined,
        },
        opciones(req)
      );
      return enviarOk(res, await hidratar(encuentros, req));
    })
  );

  router.get(
    '/destacados',
    asyncHandler(async (req, res) => {
      const { encuentros = [] } = await deportes.ListarDestacados(
        { limite: limiteDe(req.query.limite, 4, 50) },
        opciones(req)
      );
      enviarOk(res, await hidratar(encuentros, req));
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = enteroPositivo(req.params.id);
      if (!id) return enviarError(res, 'Identificador de partido inválido', 400);

      const detalle = await deportes.ObtenerDetalleEncuentro({ id }, opciones(req));
      if (!detalle?.encuentro) return enviarError(res, 'Partido no encontrado', 404);

      const [match] = await hidratar([detalle.encuentro], req);
      return enviarOk(res, {
        ...match,
        stats: aStats(detalle.estadisticas),
        lineup: (detalle.alineacion ?? []).map(aLineup),
      });
    })
  );

  return router;
}

export function crearRutasCalendario({ clientes, log }) {
  const router = Router();
  const { hidratar } = crearHidratadorEncuentros({ clientes, log });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { jornadas = [] } = await clientes.deportes.ListarCalendario(
        { idTorneo: enteroPositivo(req.query.ligaId), numeroJornada: enteroPositivo(req.query.jornada) },
        opciones(req)
      );
      // Una sola hidratacion para TODOS los partidos de todas las jornadas.
      const partidos = await hidratar(jornadas.flatMap((j) => j.encuentros ?? []), req);
      const porId = new Map(partidos.map((m) => [m.id, m]));
      enviarOk(
        res,
        jornadas.map((j) => aJornada(j, (j.encuentros ?? []).map((e) => porId.get(Number(e.id))).filter(Boolean)))
      );
    })
  );

  return router;
}
