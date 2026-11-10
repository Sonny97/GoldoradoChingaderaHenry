/**
 * Promociones: /api/promociones/*  (ms-apuestas, PostgreSQL).
 *
 * PostgreSQL solo guarda los ids de los torneos de cada promocion (referencia
 * externa: los torneos son de MySQL). El BFF pone los nombres con
 * ms-deportes.ListarTorneos y el banner con ms-imagenes. Ambos son
 * secundarios: si fallan, `leagues[].name` y `imageUrl` quedan en null.
 */

import { Router } from 'express';

import { crearBuscadorImagenes } from '../agregadores/imagenes.js';
import { aPromo } from '../mapeadores/apuestas.js';
import { enviarError, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { enteroPositivo, opciones } from '../utils/contexto.js';

export function crearRutasPromociones({ clientes, log }) {
  const router = Router();
  const imagenes = crearBuscadorImagenes({ clientes, log });
  const apuestas = clientes.apuestas;

  /** Promocion[] del proto -> Promo[] con nombres de torneo e imagen. */
  async function completar(promociones, req) {
    if (promociones.length === 0) return [];
    const [torneos, banners] = await Promise.allSettled([
      clientes.deportes.ListarTorneos({}, opciones(req)),
      imagenes.pedir('promocion', promociones.map((p) => p.id), req),
    ]);

    const nombresTorneo = new Map();
    if (torneos.status === 'fulfilled') {
      for (const t of torneos.value?.torneos ?? []) nombresTorneo.set(t.id, t.nombre);
    } else {
      log.aviso(`ListarTorneos fallo (promociones sin nombres de liga): ${torneos.reason?.details ?? torneos.reason?.message}`);
    }
    const urls = imagenes.aIndice(banners, 'BuscarImagenes(promocion)');

    return promociones.map((p) => aPromo(p, { nombresTorneo, imageUrl: urls.get(String(p.id)) }));
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { promociones = [] } = await apuestas.ListarPromociones(
        {
          limite: enteroPositivo(req.query.limite),
          // Los parametros de query llegan como cadena: 'false' es un texto no
          // vacio y por lo tanto verdadero. Hay que comparar contra 'true'.
          excluirDestacada: req.query.excluirDestacada === 'true',
        },
        opciones(req)
      );
      enviarOk(res, await completar(promociones, req));
    })
  );

  router.get(
    '/destacada',
    asyncHandler(async (req, res) => {
      const promocion = await apuestas.PromocionDestacada({}, opciones(req));
      if (!promocion?.id) return enviarError(res, 'No hay promociones disponibles', 404);
      const [promo] = await completar([promocion], req);
      return enviarOk(res, promo);
    })
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const id = enteroPositivo(req.params.id);
      if (!id) return enviarError(res, 'Promoción no encontrada', 404);
      const promocion = await apuestas.ObtenerPromocion({ id }, opciones(req));
      const [promo] = await completar([promocion], req);
      return enviarOk(res, promo);
    })
  );

  return router;
}
