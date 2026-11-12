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

import { aBilletera, aRetiro } from '../mapeadores/apuestas.js';
import { aMovement } from '../mapeadores/transacciones.js';
import { requierePerfilCompleto } from '../middleware/autenticar.js';
import { enviarError, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { limiteDe, opciones, texto } from '../utils/contexto.js';

const TIPOS = new Set(['DEPOSITO', 'RETIRO', 'APUESTA', 'PREMIO', 'REEMBOLSO']);
const TIPOS_CUENTA = new Set(['AHORROS', 'CORRIENTE']);
const RETIRO_MINIMO = 10000;

/** Mensaje de validacion del cuerpo de un retiro, o null si esta bien. */
function validarRetiro({ monto, banco, tipoCuenta, numeroCuenta }) {
  if (!Number.isInteger(monto) || monto <= 0) return 'Ingresa un monto válido';
  if (monto < RETIRO_MINIMO) return 'El monto mínimo de retiro es $10.000';
  if (!banco) return 'Selecciona el banco de destino';
  if (!TIPOS_CUENTA.has(tipoCuenta)) return 'Selecciona el tipo de cuenta (AHORROS o CORRIENTE)';
  if (!/^\d{6,20}$/.test(numeroCuenta)) return 'El número de cuenta debe tener entre 6 y 20 dígitos';
  return null;
}

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

  /**
   * Retiro a cuenta bancaria. La transferencia es SIMULADA (no hay pasarela de
   * pagos salientes): ms-apuestas descuenta el saldo y deja el movimiento RETIRO
   * en el libro. Aqui solo se valida la forma; el saldo lo decide ms-apuestas.
   */
  router.post(
    '/retiros',
    // Antes que el perfil: el admin de la semilla no tiene ficha y el mensaje
    // correcto para el es este, no "completa tu perfil".
    (req, res, next) =>
      req.usuario.rol === 'admin'
        ? enviarError(res, 'Las cuentas de administrador no pueden retirar', 403)
        : next(),
    requierePerfilCompleto('Completa tu perfil para retirar'),
    asyncHandler(async (req, res) => {
      const cuerpo = req.body ?? {};
      const datos = {
        monto: Number(cuerpo.amount),
        banco: texto(cuerpo.bank).trim().slice(0, 80),
        tipoCuenta: texto(cuerpo.accountType).trim().toUpperCase(),
        numeroCuenta: texto(cuerpo.accountNumber).replace(/[\s-]/g, ''),
      };
      const error = validarRetiro(datos);
      if (error) return enviarError(res, error, 400);

      const r = await clientes.apuestas.SolicitarRetiro(
        { idUsuario: req.usuario.idUsuario, ...datos },
        opciones(req)
      );
      return enviarOk(res, aRetiro(r), 'Retiro registrado', 201);
    })
  );

  return router;
}
