/**
 * Implementacion de cada RPC de proto/pagos.proto.
 *
 * Los handlers TRADUCEN: toman el request (camelCase, ya decodificado), llaman
 * al servicio y arman la respuesta campo por campo. No deciden reglas ni tocan
 * Firestore. Los ErrorNegocio los convierte en estado gRPC el servidor de
 * @goldorado/comun.
 *
 * Se mapea campo por campo para que nada interno (pagador, documento, ids
 * duplicados, URL de redireccion...) salga por el contrato sin querer. Los
 * `optional` sin valor se omiten (quedan undefined del otro lado).
 */

import { aFechaHoraIso } from '@goldorado/comun';

const texto = (valor) => (valor === null || valor === undefined ? '' : String(valor));
const opcional = (valor) => (valor === null || valor === undefined || valor === '' ? undefined : String(valor));

export function aPago(p) {
  return {
    referencia: texto(p.referencia),
    idUsuario: Number(p.idUsuario ?? 0),
    monto: Number(p.monto ?? 0),
    moneda: texto(p.moneda) || 'COP',
    metodo: texto(p.metodo),
    estado: texto(p.estado),
    mensajeEstado: opcional(p.mensajeEstado),
    idTransaccionWompi: opcional(p.idTransaccionWompi),
    urlPago: opcional(p.urlPago),
    acreditado: p.acreditado === true,
    creadoEn: texto(aFechaHoraIso(p.creadoEn)),
    actualizadoEn: texto(aFechaHoraIso(p.actualizadoEn)),
    banco: opcional(p.banco?.nombre),
    medioWompi: opcional(p.medioWompi),
  };
}

/**
 * @param {{ pagos: ReturnType<typeof import('../servicios/pagoServicio.js').crearServicioPagos>, salud: Function }} deps
 */
export function crearHandlers({ pagos, salud }) {
  return {
    Salud: () => salud(),

    async ObtenerConfiguracion() {
      const c = await pagos.obtenerConfiguracion();
      return {
        modo: texto(c.modo),
        llavePublica: texto(c.llavePublica),
        moneda: texto(c.moneda),
        montoMinimo: Number(c.montoMinimo),
        montoMaximo: Number(c.montoMaximo),
        metodos: c.metodos.map(String),
        montosSugeridos: c.montosSugeridos.map(Number),
        urlReglamento: texto(c.urlReglamento),
        urlDatosPersonales: texto(c.urlDatosPersonales),
      };
    },

    async ListarBancosPse() {
      const bancos = await pagos.listarBancosPse();
      return { bancos: bancos.map((b) => ({ codigo: texto(b.codigo), nombre: texto(b.nombre) })) };
    },

    async CrearPagoPse(req) {
      return aPago(
        await pagos.crearPagoPse({
          idUsuario: req.idUsuario,
          monto: req.monto,
          codigoBanco: req.codigoBanco,
          tipoPersona: req.tipoPersona,
          pagador: req.pagador ?? {},
          urlRetorno: req.urlRetorno,
          ip: req.ip,
          aceptaReglamento: req.aceptaReglamento,
          aceptaDatosPersonales: req.aceptaDatosPersonales,
        })
      );
    },

    async CrearPagoCheckout(req) {
      return aPago(
        await pagos.crearPagoCheckout({
          idUsuario: req.idUsuario,
          monto: req.monto,
          pagador: req.pagador ?? {},
          urlRetorno: req.urlRetorno,
        })
      );
    },

    async ConsultarPago(req) {
      return aPago(
        await pagos.consultarPago({
          referencia: req.referencia,
          idTransaccionWompi: req.idTransaccionWompi,
          idUsuario: req.idUsuario,
        })
      );
    },

    async ListarPagos(req) {
      const lista = await pagos.listarPagos({ idUsuario: req.idUsuario, limite: req.limite });
      return { pagos: lista.map(aPago) };
    },

    async ProcesarEventoWompi(req) {
      const r = await pagos.procesarEventoWompi({ cuerpoJson: req.cuerpoJson, checksumCabecera: req.checksumCabecera });
      return { aceptado: r.aceptado === true, referencia: texto(r.referencia), estado: texto(r.estado) };
    },
  };
}
