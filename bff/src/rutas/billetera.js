/**
 * Billetera: /api/billetera/*  (saldo de ms-apuestas en PostgreSQL + libro de
 * movimientos de ms-transacciones en MongoDB).
 *
 * El saldo y el libro viven en bases distintas a proposito: PostgreSQL lleva el
 * saldo con transacciones ACID (no se puede apostar dos veces el mismo peso) y
 * MongoDB guarda la historia completa de cada movimiento con sus cambios de
 * estado. Aqui son dos rutas separadas porque la pantalla las pide por separado.
 */

import { CODIGOS } from '@goldorado/comun';
import { Router } from 'express';

import { aBilletera } from '../mapeadores/apuestas.js';
import { aMovement } from '../mapeadores/transacciones.js';
import { enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { limiteDe, opciones } from '../utils/contexto.js';

const TIPOS = new Set(['DEPOSITO', 'RETIRO', 'APUESTA', 'PREMIO', 'REEMBOLSO']);

export function crearRutasBilletera({ clientes, guardas }) {
  const router = Router();
  router.use(guardas.autenticar);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      try {
        const b = await clientes.apuestas.ObtenerBilletera({ idUsuario: req.usuario.idUsuario }, opciones(req));
        enviarOk(res, aBilletera(b));
      } catch (error) {
        // Sin billetera todavia = saldo cero (se crea con el primer deposito).
        if (error?.code !== CODIGOS.NOT_FOUND) throw error;
        enviarOk(res, { balance: 0, lockedBalance: 0, currency: 'COP' });
      }
    })
  );

  router.get(
    '/movimientos',
    asyncHandler(async (req, res) => {
      const tipo = typeof req.query.tipo === 'string' ? req.query.tipo.trim().toUpperCase() : '';
      const { transacciones = [] } = await clientes.transacciones.ListarTransacciones(
        {
          idUsuario: req.usuario.idUsuario,
          limite: limiteDe(req.query.limite, 20, 100),
          tipo: TIPOS.has(tipo) ? tipo : undefined,
        },
        opciones(req)
      );
      enviarOk(res, transacciones.map(aMovement));
    })
  );

  return router;
}
