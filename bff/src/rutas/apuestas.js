/**
 * Apuestas: /api/apuestas/*  (ms-apuestas, PostgreSQL). TODAS con sesion:
 * mueven dinero de una cuenta concreta.
 *
 * El id del usuario sale del TOKEN (req.usuario), nunca del body. Si se leyera
 * del body, cualquiera podria apostar con el saldo de otro mandando un id
 * distinto. Igual con la cuota: se manda el id y ms-apuestas lee el valor
 * vigente; el valor que muestra el navegador no cuenta.
 *
 * El historial se hidrata con ms-deportes (equipos, estado y liga del partido).
 * Es secundario: si MySQL no responde, la lista sale igual con match.home = null.
 */

import { Router } from 'express';

import { aApuestaRegistrada, aBet, aResumen } from '../mapeadores/apuestas.js';
import { requierePerfilCompleto } from '../middleware/autenticar.js';
import { ErrorHttp, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { enteroPositivo, limiteDe, opciones } from '../utils/contexto.js';

export function crearRutasApuestas({ clientes, log, guardas }) {
  const router = Router();
  const apuestas = clientes.apuestas;

  // Se aplica a todo el router: no hay ninguna ruta de apuestas publica.
  router.use(guardas.autenticar);

  router.post(
    '/',
    requierePerfilCompleto('Completa tu perfil para apostar'),
    asyncHandler(async (req, res) => {
      const idCuota = enteroPositivo(req.body?.oddsId);
      if (!idCuota) throw new ErrorHttp(400, 'Selecciona una cuota para apostar');
      const monto = Number(req.body?.amount);
      if (req.body?.amount === undefined || req.body?.amount === '' || !Number.isFinite(monto)) {
        throw new ErrorHttp(400, 'Ingresa un monto válido');
      }

      const r = await apuestas.RegistrarApuesta({ idUsuario: req.usuario.idUsuario, idCuota, monto }, opciones(req));
      enviarOk(res, aApuestaRegistrada(r), 'Apuesta registrada', 201);
    })
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { apuestas: lista = [] } = await apuestas.ListarApuestas(
        { idUsuario: req.usuario.idUsuario, limite: limiteDe(req.query.limite, 20, 100) },
        opciones(req)
      );

      const ids = [...new Set(lista.map((a) => Number(a.idEncuentro)).filter(Boolean))];
      const [partidos] = await Promise.allSettled([
        ids.length ? clientes.deportes.ObtenerEncuentrosPorIds({ ids }, opciones(req)) : Promise.resolve({ encuentros: [] }),
      ]);
      const porId = new Map();
      if (partidos.status === 'fulfilled') {
        for (const e of partidos.value?.encuentros ?? []) porId.set(Number(e.id), e);
      } else {
        log.aviso(`ObtenerEncuentrosPorIds fallo (historial sin datos del partido): ${partidos.reason?.details ?? partidos.reason?.message}`);
      }

      enviarOk(res, lista.map((a) => aBet(a, porId.get(Number(a.idEncuentro)))));
    })
  );

  /** Alimenta el panel "Tu semana" del dashboard. */
  router.get(
    '/resumen',
    asyncHandler(async (req, res) => {
      const r = await apuestas.ResumenApuestas({ idUsuario: req.usuario.idUsuario }, opciones(req));
      enviarOk(res, aResumen(r));
    })
  );

  return router;
}
