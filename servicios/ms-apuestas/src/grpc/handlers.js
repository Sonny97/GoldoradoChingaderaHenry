/**
 * Implementacion de cada RPC de proto/apuestas.proto.
 *
 * Los handlers TRADUCEN: toman el request (camelCase, ya decodificado), llaman
 * al servicio y arman la respuesta campo por campo. Ni deciden reglas ni
 * escriben consultas. Los errores de negocio (ErrorNegocio) los convierte en
 * estado gRPC el servidor de @goldorado/comun; los de la base los traduce
 * traducirErrorBaseDatos, sin filtrar el texto del motor al cliente.
 *
 * Se mapea campo por campo (y no se devuelve el objeto del servicio tal cual)
 * para que un campo nuevo en un repositorio no salga por el contrato sin querer.
 */

const texto = (valor) => (valor === null || valor === undefined ? '' : String(valor));
const numero = (valor) => (valor === null || valor === undefined ? 0 : Number(valor));

function aCuota(c) {
  return {
    idCuota: c.idCuota,
    idEncuentro: c.idEncuentro,
    codigoCorto: texto(c.codigoCorto),
    seleccion: texto(c.seleccion),
    valor: numero(c.valor),
    mercado: texto(c.mercado),
    estado: texto(c.estado),
    orden: numero(c.orden),
  };
}

function aApuesta(a) {
  return {
    id: a.id,
    estado: texto(a.estado),
    monto: numero(a.monto),
    cuota: numero(a.cuota),
    gananciaPotencial: numero(a.gananciaPotencial),
    fecha: texto(a.fecha),
    seleccion: texto(a.seleccion),
    mercado: texto(a.mercado),
    idEncuentro: a.idEncuentro,
    idTransaccion: texto(a.idTransaccion),
  };
}

function aBilletera(b) {
  return {
    idUsuario: b.idUsuario,
    saldoDisponible: numero(b.saldoDisponible),
    saldoBloqueado: numero(b.saldoBloqueado),
    moneda: texto(b.moneda) || 'COP',
  };
}

function aPromocion(p) {
  return {
    id: p.id,
    titulo: texto(p.titulo),
    subtitulo: texto(p.subtitulo),
    descripcion: texto(p.descripcion),
    badge: texto(p.badge),
    ctaLabel: texto(p.ctaLabel),
    acento: texto(p.acento),
    destacada: Boolean(p.destacada),
    fechaExpira: texto(p.fechaExpira),
    idsTorneo: p.idsTorneo ?? [],
  };
}

/**
 * @param {object} o
 * @param {ReturnType<import('../servicios/apuestaServicio.js').crearServicioApuestas>} o.apuestas
 * @param {ReturnType<import('../servicios/billeteraServicio.js').crearServicioBilletera>} o.billetera
 * @param {ReturnType<import('../servicios/promocionServicio.js').crearServicioPromociones>} o.promociones
 * @param {Function} o.salud  crearRpcSalud(...)
 */
export function crearHandlers({ apuestas, billetera, promociones, salud }) {
  return {
    Salud: salud,

    // ---------------------------------------------------------------- cuotas
    async CuotasPorEncuentros({ idsEncuentro }) {
      const cuotas = await apuestas.cuotasPorEncuentros(idsEncuentro);
      return { cuotas: cuotas.map(aCuota) };
    },

    // -------------------------------------------------------------- apuestas
    async RegistrarApuesta({ idUsuario, idCuota, monto }) {
      const r = await apuestas.registrarApuesta({ idUsuario, idCuota, monto });
      return {
        idApuesta: r.idApuesta,
        idTransaccion: texto(r.idTransaccion),
        monto: numero(r.monto),
        cuota: numero(r.cuota),
        gananciaPotencial: numero(r.gananciaPotencial),
        fecha: texto(r.fecha),
        idEncuentro: r.idEncuentro,
        seleccion: texto(r.seleccion),
        mercado: texto(r.mercado),
        saldoDisponible: numero(r.saldoDisponible),
        saldoBloqueado: numero(r.saldoBloqueado),
      };
    },

    async ListarApuestas({ idUsuario, limite }) {
      const lista = await apuestas.historial(idUsuario, { limite });
      return { apuestas: lista.map(aApuesta) };
    },

    async ResumenApuestas({ idUsuario }) {
      const r = await apuestas.resumen(idUsuario);
      return {
        total: numero(r.total),
        ganadas: numero(r.ganadas),
        perdidas: numero(r.perdidas),
        pendientes: numero(r.pendientes),
        apostado: numero(r.apostado),
        retornado: numero(r.retornado),
        rendimiento: numero(r.rendimiento),
      };
    },

    // ------------------------------------------------------------- billetera
    async AsegurarBilletera({ idUsuario }) {
      return aBilletera(await billetera.asegurar(idUsuario));
    },

    async ObtenerBilletera({ idUsuario }) {
      return aBilletera(await billetera.obtener(idUsuario));
    },

    async AcreditarDeposito({ idUsuario, monto, referencia, proveedor, metodo, idTransaccionPasarela }) {
      const r = await billetera.acreditarDeposito({
        idUsuario,
        monto,
        referencia,
        proveedor,
        metodo,
        idTransaccionPasarela,
      });
      return { aplicado: Boolean(r.aplicado), billetera: aBilletera(r.billetera) };
    },

    async SolicitarRetiro({ idUsuario, monto, banco, tipoCuenta, numeroCuenta }) {
      const r = await billetera.solicitarRetiro({ idUsuario, monto, banco, tipoCuenta, numeroCuenta });
      return {
        referencia: texto(r.referencia),
        monto: numero(r.monto),
        billetera: aBilletera(r.billetera),
        fecha: texto(r.fecha),
      };
    },

    // ----------------------------------------------------------- liquidacion
    async LiquidarEncuentro({ idEncuentro }) {
      const r = await apuestas.liquidarEncuentro(idEncuentro);
      return {
        idEncuentro: r.idEncuentro,
        estadoPartido: texto(r.estadoPartido),
        liquidadas: numero(r.liquidadas),
        ganadas: numero(r.ganadas),
        perdidas: numero(r.perdidas),
        anuladas: numero(r.anuladas),
        totalPremios: numero(r.totalPremios),
      };
    },

    // ----------------------------------------------------------- promociones
    async ListarPromociones({ limite, excluirDestacada }) {
      const lista = await promociones.listar({ limite, excluirDestacada });
      return { promociones: lista.map(aPromocion) };
    },

    async PromocionDestacada() {
      return aPromocion(await promociones.destacada());
    },

    async ObtenerPromocion({ id }) {
      return aPromocion(await promociones.obtener(id));
    },
  };
}
