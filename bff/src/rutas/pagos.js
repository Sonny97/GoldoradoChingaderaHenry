/**
 * Pagos con Wompi: /api/pagos/*  (ms-pagos, Firestore).
 *
 * El BFF no habla con Wompi: arma la peticion para ms-pagos con lo que solo el
 * conoce (el usuario del token, su perfil de ms-autenticacion, la IP real y la
 * URL del frontend) y traduce la respuesta. Las llaves de Wompi viven en
 * ms-pagos.
 *
 * Datos del pagador: salen del PERFIL, no del body. El body solo puede cambiar
 * el tipo y numero de documento (pagar con el documento del titular de la
 * cuenta bancaria, que puede ser otra persona).
 *
 * El webhook (POST /api/pagos/webhook) NO esta aqui: necesita el cuerpo CRUDO
 * para que el checksum cuadre byte a byte, asi que se monta en app.js antes de
 * express.json(). Ver crearManejadorWebhook al final de este archivo.
 */

import { CODIGOS } from '@goldorado/comun';
import { Router } from 'express';

import { PLAZOS } from '../clientes.js';
import { requierePerfilCompleto } from '../middleware/autenticar.js';
import { aBanco, aConfigPagos, aPayment } from '../mapeadores/pagos.js';
import { ErrorHttp, enviarOk, fail } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ipDe, limiteDe, opciones, texto } from '../utils/contexto.js';

const MENSAJE_CONTRATOS = 'Debes aceptar el reglamento y la autorización de datos personales de Wompi';
const REFERENCIA_VALIDA = /^[A-Za-z0-9._-]{1,80}$/;

function montoDe(body) {
  const monto = Number(body?.amount);
  if (body?.amount === undefined || body?.amount === '' || !Number.isFinite(monto) || monto <= 0) {
    throw new ErrorHttp(400, 'Ingresa un monto válido');
  }
  return monto;
}

export function crearRutasPagos({ clientes, env, guardas, limites }) {
  const router = Router();
  const pagos = clientes.pagos;
  const urlRetorno = `${String(env.WEB_URL).replace(/\/+$/, '')}/pagos/resultado`;
  const perfilCompleto = requierePerfilCompleto('Completa tu perfil para continuar');

  /** Pagador del perfil; el body solo puede reemplazar el documento. */
  async function pagadorDe(req) {
    const u = await clientes.autenticacion.ObtenerUsuario({ idUsuario: req.usuario.idUsuario }, opciones(req));
    const body = req.body ?? {};
    return {
      email: u.email,
      nombreCompleto: u.nombreCompleto || `${u.nombres ?? ''} ${u.apellidos ?? ''}`.trim(),
      telefono: u.telefono ?? '',
      tipoDocumento: texto(body.documentType).trim() || u.tipoDocumento || '',
      numeroDocumento: texto(body.documentNumber).trim() || u.numeroDocumento || '',
    };
  }

  router.get(
    '/config',
    asyncHandler(async (req, res) => {
      enviarOk(res, aConfigPagos(await pagos.ObtenerConfiguracion({}, opciones(req))));
    })
  );

  router.get(
    '/pse/bancos',
    guardas.autenticar,
    asyncHandler(async (req, res) => {
      const { bancos = [] } = await pagos.ListarBancosPse({}, opciones(req, { plazoMs: PLAZOS.pago }));
      enviarOk(res, bancos.map(aBanco));
    })
  );

  router.post(
    '/pse',
    guardas.autenticar,
    perfilCompleto,
    limites.limitePagos,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const monto = montoDe(body);
      if (body.acceptTerms !== true || body.acceptPersonalData !== true) {
        throw new ErrorHttp(400, MENSAJE_CONTRATOS);
      }
      const codigoBanco = texto(body.bankCode).trim();
      if (!codigoBanco) throw new ErrorHttp(400, 'Selecciona tu banco');

      const pago = await pagos.CrearPagoPse(
        {
          idUsuario: req.usuario.idUsuario,
          monto,
          codigoBanco,
          tipoPersona: Number(body.personType) === 1 ? 1 : 0,
          pagador: await pagadorDe(req),
          urlRetorno,
          ip: ipDe(req),
          aceptaReglamento: true,
          aceptaDatosPersonales: true,
        },
        opciones(req, { plazoMs: PLAZOS.pago })
      );
      enviarOk(res, aPayment(pago), 'Pago creado', 201);
    })
  );

  router.post(
    '/checkout',
    guardas.autenticar,
    perfilCompleto,
    limites.limitePagos,
    asyncHandler(async (req, res) => {
      const monto = montoDe(req.body);
      const pago = await pagos.CrearPagoCheckout(
        { idUsuario: req.usuario.idUsuario, monto, pagador: await pagadorDe(req), urlRetorno },
        opciones(req, { plazoMs: PLAZOS.pago })
      );
      enviarOk(res, aPayment(pago), 'Pago creado', 201);
    })
  );

  router.get(
    '/',
    guardas.autenticar,
    asyncHandler(async (req, res) => {
      const { pagos: lista = [] } = await pagos.ListarPagos(
        { idUsuario: req.usuario.idUsuario, limite: limiteDe(req.query.limite, 20, 100) },
        opciones(req)
      );
      enviarOk(res, lista.map(aPayment));
    })
  );

  /** Al volver del Web Checkout Wompi agrega ?id=<transaccion>. Refresca contra Wompi. */
  router.get(
    '/wompi/:idTransaccion',
    guardas.autenticar,
    asyncHandler(async (req, res) => {
      const id = String(req.params.idTransaccion);
      if (!REFERENCIA_VALIDA.test(id)) throw new ErrorHttp(404, 'Pago no encontrado');
      const pago = await pagos.ConsultarPago(
        { idTransaccionWompi: id, idUsuario: req.usuario.idUsuario },
        opciones(req, { plazoMs: PLAZOS.pago })
      );
      enviarOk(res, aPayment(pago));
    })
  );

  /** Estado del pago refrescado contra Wompi; ms-pagos revisa que sea del usuario (403 si no). */
  router.get(
    '/:referencia',
    guardas.autenticar,
    asyncHandler(async (req, res) => {
      const referencia = String(req.params.referencia);
      if (!REFERENCIA_VALIDA.test(referencia)) throw new ErrorHttp(404, 'Pago no encontrado');
      const pago = await pagos.ConsultarPago(
        { referencia, idUsuario: req.usuario.idUsuario },
        opciones(req, { plazoMs: PLAZOS.pago })
      );
      enviarOk(res, aPayment(pago));
    })
  );

  return router;
}

/**
 * POST /api/pagos/webhook: eventos de Wompi.
 *
 * Wompi solo da por entregado un evento con un 200 EXACTO (201 y 204 cuentan
 * como fallo y reintenta). Contrato:
 *   200 { success: true }  procesado, ya procesado, o de otro ambiente
 *   401                    el checksum no coincide (ms-pagos dice UNAUTHENTICATED)
 *   500                    cualquier otro fallo: Wompi reintenta (+30 min, +3 h, +24 h)
 *
 * req.body es un Buffer (express.raw): se le pasa a ms-pagos TAL CUAL llego.
 */
export function crearManejadorWebhook({ clientes, log }) {
  return async function webhookWompi(req, res) {
    const cuerpoJson = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const checksumCabecera = String(req.get('x-event-checksum') ?? '');
    try {
      const r = await clientes.pagos.ProcesarEventoWompi(
        { cuerpoJson, checksumCabecera },
        opciones(req, { plazoMs: PLAZOS.pago })
      );
      log.info(`Webhook Wompi: ${r.referencia || '(sin referencia)'} -> ${r.estado || '-'} (aceptado=${r.aceptado})`);
      res.status(200).json({ success: true });
    } catch (error) {
      if (error?.code === CODIGOS.UNAUTHENTICATED) {
        log.aviso(`Webhook Wompi con firma invalida desde ${ipDe(req)}`);
        res.status(401).json(fail('Firma del evento inválida'));
        return;
      }
      log.aviso(`Webhook Wompi fallo (Wompi reintentara): ${error?.details ?? error?.message}`);
      res.status(500).json(fail('No se pudo procesar el evento'));
    }
  };
}
