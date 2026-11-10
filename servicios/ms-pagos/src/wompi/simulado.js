/**
 * Pasarela SIMULADA (WOMPI_MODO=simulado): misma interfaz que cliente.js, sin
 * red ni llaves. Sirve para la demostracion en clase sin conexion.
 *
 * - Bancos: "1" aprueba y "2" rechaza, como los del sandbox de Wompi.
 * - La URL de pago vuelve directo al frontend: urlRetorno?referencia=<ref>&simulado=1.
 * - El id de la transaccion es 'SIM-<referencia>'.
 * - Al CONSULTAR, la transaccion ya aparece APPROVED (o DECLINED con el banco
 *   2). El resultado lo aplica el MISMO codigo de transicion y acreditacion
 *   que en los modos reales (pagoServicio.aplicarEstadoWompi): lo unico
 *   simulado es la respuesta de "Wompi".
 *
 * No guarda estado propio: reconstruye la transaccion a partir de NUESTRO
 * registro (obtenerPago: monto, banco y urlRedireccion), asi sobrevive a un
 * reinicio con PAGOS_ALMACEN=firestore.
 */

export const PREFIJO_SIMULADO = 'SIM-';

export const BANCOS_SIMULADOS = Object.freeze([
  Object.freeze({ codigo: '1', nombre: 'Banco que aprueba (simulado)' }),
  Object.freeze({ codigo: '2', nombre: 'Banco que rechaza (simulado)' }),
]);

/** Agrega simulado=1 respetando el query que ya tenga la URL. */
function conMarcaSimulado(url) {
  const u = new URL(url);
  u.searchParams.set('simulado', '1');
  return u.toString();
}

/**
 * @param {object} o
 * @param {(referencia: string) => Promise<object|null>} o.obtenerPago  lectura de nuestro repositorio
 */
export function crearPasarelaSimulada({ obtenerPago }) {
  function transaccion(pago, estado) {
    const esPse = pago.metodo === 'PSE';
    const urlPago = pago.urlRedireccion ? conMarcaSimulado(pago.urlRedireccion) : null;
    return {
      id: `${PREFIJO_SIMULADO}${pago.referencia}`,
      created_at: (pago.creadoEn instanceof Date ? pago.creadoEn : new Date()).toISOString(),
      reference: pago.referencia,
      amount_in_cents: pago.montoCentavos,
      currency: 'COP',
      status: estado,
      status_message: estado === 'DECLINED' ? 'Transacción RECHAZADA (simulado)' : null,
      payment_method_type: esPse ? 'PSE' : 'NEQUI',
      payment_method: esPse
        ? { type: 'PSE', financial_institution_code: pago.banco?.codigo ?? '', extra: { async_payment_url: urlPago } }
        : { type: 'NEQUI', extra: {} },
    };
  }

  const estadoFinal = (pago) => (pago.metodo === 'PSE' && pago.banco?.codigo === '2' ? 'DECLINED' : 'APPROVED');

  async function pagoDeId(id) {
    if (!String(id ?? '').startsWith(PREFIJO_SIMULADO)) return null;
    return obtenerPago(String(id).slice(PREFIJO_SIMULADO.length));
  }

  return {
    modo: 'simulado',
    llavePublica: '',
    ambienteEventos: 'test',

    async obtenerInfoComercio() {
      return { urlReglamento: '', urlDatosPersonales: '' };
    },

    async obtenerTokensAceptacion() {
      return { tokenReglamento: 'simulado', tokenDatosPersonales: 'simulado', urlReglamento: '', urlDatosPersonales: '' };
    },

    async bancosPse() {
      return BANCOS_SIMULADOS.map((b) => ({ ...b }));
    },

    async crearTransaccionPse({ referencia, montoCentavos, codigoBanco, urlRedireccion }) {
      return transaccion(
        {
          referencia,
          montoCentavos,
          metodo: 'PSE',
          banco: { codigo: codigoBanco },
          urlRedireccion,
          creadoEn: new Date(),
        },
        'PENDING'
      );
    },

    async esperarUrlPse(id) {
      const pago = await pagoDeId(id);
      if (!pago) return { url: null, tx: null };
      const tx = transaccion(pago, 'PENDING');
      return { url: tx.payment_method.extra?.async_payment_url ?? null, tx };
    },

    async obtenerTransaccion(id) {
      const pago = await pagoDeId(id);
      return pago ? transaccion(pago, estadoFinal(pago)) : null;
    },

    async buscarPorReferencia(referencia) {
      const pago = await obtenerPago(referencia);
      return pago ? [transaccion(pago, estadoFinal(pago))] : [];
    },

    urlCheckout({ urlRedireccion }) {
      return conMarcaSimulado(urlRedireccion);
    },
  };
}
