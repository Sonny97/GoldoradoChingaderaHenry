/**
 * Panel de administracion: /api/admin/*  (solo rol `admin`).
 *
 * El admin mueve el partido (estado, minuto, marcador) en ms-deportes, que es
 * la fuente de verdad del resultado. Cuando el partido queda `finished` o
 * `canceled`, el BFF le pide a ms-apuestas que LIQUIDE las apuestas: ganadas,
 * perdidas o anuladas con reembolso. Son dos servicios y dos bases distintas,
 * asi que no hay una transaccion que los una: si la liquidacion falla despues
 * de guardar el partido, se responde 200 con `settlement: null` y el panel
 * ofrece reintentar (LiquidarEncuentro es idempotente: no paga dos veces).
 */

import { Router } from 'express';

import { crearHidratadorEncuentros } from '../agregadores/encuentros.js';
import { aSettlement } from '../mapeadores/apuestas.js';
import { requiereRol } from '../middleware/autenticar.js';
import { enviarError, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { enteroPositivo, opciones } from '../utils/contexto.js';

const ESTADOS = new Set(['upcoming', 'live', 'finished', 'canceled']);
const ESTADOS_LIQUIDABLES = new Set(['finished', 'canceled']);

/** Entero >= 0 opcional: undefined si no vino, NaN si vino mal. */
function enteroOpcional(valor, maximo) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const n = Number(valor);
  return Number.isInteger(n) && n >= 0 && n <= maximo ? n : Number.NaN;
}

export function crearRutasAdmin({ clientes, log, guardas }) {
  const router = Router();
  const { hidratar } = crearHidratadorEncuentros({ clientes, log });

  router.use(guardas.autenticar, requiereRol('admin', { mensaje: 'Solo un administrador puede hacer esto' }));

  async function liquidar(idEncuentro, req) {
    const r = await clientes.apuestas.LiquidarEncuentro({ idEncuentro }, opciones(req));
    return aSettlement(r);
  }

  router.get(
    '/encuentros',
    asyncHandler(async (req, res) => {
      const { encuentros = [] } = await clientes.deportes.ListarEncuentros({ estado: 'all' }, opciones(req));
      enviarOk(res, await hidratar(encuentros, req));
    })
  );

  router.patch(
    '/encuentros/:id',
    asyncHandler(async (req, res) => {
      const id = enteroPositivo(req.params.id);
      if (!id) return enviarError(res, 'Identificador de partido inválido', 400);

      const cuerpo = req.body ?? {};
      const estado = typeof cuerpo.status === 'string' ? cuerpo.status.trim().toLowerCase() : '';
      if (!ESTADOS.has(estado)) {
        return enviarError(res, 'Estado inválido: usa upcoming, live, finished o canceled', 400);
      }
      const minuto = enteroOpcional(cuerpo.minute, 130);
      const golesLocal = enteroOpcional(cuerpo.homeScore, 99);
      const golesVisitante = enteroOpcional(cuerpo.awayScore, 99);
      if (Number.isNaN(minuto)) return enviarError(res, 'El minuto debe ser un entero entre 0 y 130', 400);
      if (Number.isNaN(golesLocal) || Number.isNaN(golesVisitante)) {
        return enviarError(res, 'El marcador debe ser un entero entre 0 y 99', 400);
      }

      const encuentro = await clientes.deportes.ActualizarEncuentro(
        { id, estado, minuto, golesLocal, golesVisitante },
        opciones(req)
      );
      const [match] = await hidratar([encuentro], req);

      if (!ESTADOS_LIQUIDABLES.has(encuentro.estado)) {
        return enviarOk(res, { match, settlement: null }, 'Partido actualizado');
      }

      try {
        const settlement = await liquidar(id, req);
        return enviarOk(res, { match, settlement }, 'Partido actualizado y apuestas liquidadas');
      } catch (error) {
        // El partido YA quedo guardado: no se responde error, se avisa.
        log.aviso(`LiquidarEncuentro ${id} fallo tras actualizar el partido: ${error?.details ?? error?.message}`);
        return enviarOk(
          res,
          { match, settlement: null },
          'El partido se actualizó, pero no se pudieron liquidar las apuestas. Reintenta la liquidación.'
        );
      }
    })
  );

  router.post(
    '/encuentros/:id/liquidar',
    asyncHandler(async (req, res) => {
      const id = enteroPositivo(req.params.id);
      if (!id) return enviarError(res, 'Identificador de partido inválido', 400);
      return enviarOk(res, await liquidar(id, req), 'Apuestas liquidadas');
    })
  );

  return router;
}
