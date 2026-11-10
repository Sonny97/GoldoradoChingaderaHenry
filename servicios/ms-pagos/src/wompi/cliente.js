/**
 * Cliente HTTP de la API de Wompi (sandbox o produccion), con fetch nativo.
 *
 * Reglas que vienen de docs/WOMPI.md (verificadas contra el sandbox):
 * - Tokens de aceptacion: GET /merchants/info con el header
 *   x-merchant-public-key. Son de UN solo uso y vencen en 1 hora: se piden
 *   NUEVOS para cada transaccion y nunca se cachean. Lo que si se cachea
 *   (~10 min) son los `permalink` de los contratos, que solo sirven para
 *   pintar las dos casillas de la pantalla de recarga.
 * - Bancos PSE: con la llave PUBLICA como Bearer; cambian poco (cache 1 h).
 * - Crear y consultar transacciones: SIEMPRE con la llave PRIVADA.
 * - async_payment_url no viene al crear la transaccion PSE: hay que consultarla
 *   hasta que aparezca (esperarUrlPse).
 *
 * Errores: un timeout o una caida de red se vuelve UNAVAILABLE ("Wompi no
 * responde en este momento"); un 422 se vuelve INVALID_ARGUMENT con el motivo
 * en espanol. Nunca se escriben en el log llaves, firmas ni tokens: solo
 * metodo, ruta y estado HTTP.
 */

import { invalido, noDisponible } from '@goldorado/comun';
import { firmaIntegridad, urlCheckout as armarUrlCheckout } from './firmas.js';

export const URL_API = Object.freeze({
  sandbox: 'https://sandbox.wompi.co/v1',
  produccion: 'https://production.wompi.co/v1',
});

const DIEZ_MINUTOS = 10 * 60 * 1000;
const UNA_HORA = 60 * 60 * 1000;
const SIN_RESPUESTA = 'Wompi no responde en este momento';

// Nombres legibles de los campos que Wompi suele rechazar con 422.
const NOMBRES_CAMPO = {
  acceptance_token: 'reglamento de Wompi',
  accept_personal_auth: 'autorización de datos personales',
  amount_in_cents: 'monto',
  currency: 'moneda',
  customer_email: 'correo',
  reference: 'referencia',
  signature: 'firma de integridad',
  redirect_url: 'URL de retorno',
  ip: 'IP',
  'customer_data.full_name': 'nombre',
  'customer_data.phone_number': 'teléfono',
  'payment_method.user_type': 'tipo de persona',
  'payment_method.user_legal_id_type': 'tipo de documento',
  'payment_method.user_legal_id': 'número de documento',
  'payment_method.financial_institution_code': 'banco',
  'payment_method.payment_description': 'descripción del pago',
};

/** Aplana {"payment_method":{"user_legal_id":["..."]}} a ["número de documento: ..."]. */
function aplanarMensajes(mensajes, prefijo = '') {
  if (Array.isArray(mensajes)) {
    const nombre = NOMBRES_CAMPO[prefijo] ?? prefijo;
    return mensajes.map((m) => (nombre ? `${nombre}: ${m}` : String(m)));
  }
  if (mensajes && typeof mensajes === 'object') {
    return Object.entries(mensajes).flatMap(([clave, valor]) =>
      aplanarMensajes(valor, prefijo ? `${prefijo}.${clave}` : clave)
    );
  }
  return mensajes ? [String(mensajes)] : [];
}

/** Mensaje en espanol, listo para el usuario, a partir del cuerpo de error de Wompi. */
export function mensajeErrorWompi(cuerpo) {
  const error = cuerpo?.error ?? {};
  const partes = aplanarMensajes(error.messages);
  if (!partes.length && error.reason) partes.push(String(error.reason));
  const detalle = partes.join('; ').slice(0, 300);
  return detalle ? `Wompi rechazó la solicitud: ${detalle}` : 'Wompi rechazó la solicitud';
}

const esperarMs = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * @param {object} o
 * @param {'sandbox'|'produccion'} o.modo
 * @param {string} o.llavePublica
 * @param {string} o.llavePrivada
 * @param {string} o.secretoIntegridad
 * @param {number} [o.plazoMs]
 * @param {object} [o.log]
 * @param {typeof fetch} [o.fetch]       inyectable para pruebas
 * @param {(ms:number)=>Promise<void>} [o.esperar]
 * @param {() => number} [o.ahora]
 */
export function crearClienteWompi({
  modo,
  llavePublica,
  llavePrivada,
  secretoIntegridad,
  plazoMs = 15000,
  log,
  fetch: hacerFetch = globalThis.fetch,
  esperar = esperarMs,
  ahora = Date.now,
}) {
  const base = URL_API[modo];
  if (!base) throw new Error(`Modo de Wompi sin API: ${modo}`);

  let cacheInfo = null; // { valor, vence }
  let cacheBancos = null;

  async function llamar(metodo, ruta, { autorizacion, cuerpo, cabeceras, permitir404 = false } = {}) {
    let respuesta;
    try {
      respuesta = await hacerFetch(base + ruta, {
        method: metodo,
        signal: AbortSignal.timeout(plazoMs),
        headers: {
          Accept: 'application/json',
          ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
          ...(autorizacion ? { Authorization: `Bearer ${autorizacion}` } : {}),
          ...cabeceras,
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (error) {
      log?.aviso(`Wompi ${metodo} ${ruta} sin respuesta (${error?.name ?? 'error'}: ${error?.message ?? ''})`);
      throw noDisponible(SIN_RESPUESTA);
    }

    const json = await respuesta.json().catch(() => null);
    if (respuesta.ok) return json;
    if (respuesta.status === 404 && permitir404) return null;

    log?.aviso(`Wompi ${metodo} ${ruta} -> HTTP ${respuesta.status} (${json?.error?.type ?? 'sin tipo'})`);
    if (respuesta.status === 401 || respuesta.status === 403) {
      log?.error(
        `Wompi rechazo las llaves (HTTP ${respuesta.status}). Revisa WOMPI_LLAVE_PUBLICA / WOMPI_LLAVE_PRIVADA ` +
          `y que sean del ambiente ${modo} (las _test_ no sirven en produccion ni al reves).`
      );
      throw noDisponible('La pasarela de pagos no está disponible en este momento');
    }
    if (respuesta.status === 429 || respuesta.status >= 500) throw noDisponible(SIN_RESPUESTA);
    throw invalido(mensajeErrorWompi(json));
  }

  async function merchantsInfo() {
    const json = await llamar('GET', '/merchants/info', { cabeceras: { 'x-merchant-public-key': llavePublica } });
    const datos = json?.data ?? {};
    return {
      tokenReglamento: datos.presigned_acceptance?.acceptance_token ?? '',
      urlReglamento: datos.presigned_acceptance?.permalink ?? '',
      tokenDatosPersonales: datos.presigned_personal_data_auth?.acceptance_token ?? '',
      urlDatosPersonales: datos.presigned_personal_data_auth?.permalink ?? '',
    };
  }

  async function obtenerTransaccion(id) {
    const json = await llamar('GET', `/transactions/${encodeURIComponent(id)}`, {
      autorizacion: llavePrivada,
      permitir404: true,
    });
    return json?.data ?? null;
  }

  return {
    modo,
    llavePublica,
    // `environment` que traen los eventos de este ambiente.
    ambienteEventos: modo === 'produccion' ? 'prod' : 'test',

    /** Permalinks de los contratos (cache ~10 min). */
    async obtenerInfoComercio() {
      if (cacheInfo && cacheInfo.vence > ahora()) return cacheInfo.valor;
      const { urlReglamento, urlDatosPersonales } = await merchantsInfo();
      cacheInfo = { valor: { urlReglamento, urlDatosPersonales }, vence: ahora() + DIEZ_MINUTOS };
      return cacheInfo.valor;
    },

    /** Tokens NUEVOS (un solo uso, vencen en 1 hora): nunca cacheados. */
    async obtenerTokensAceptacion() {
      const tokens = await merchantsInfo();
      if (!tokens.tokenReglamento || !tokens.tokenDatosPersonales) {
        throw noDisponible('Wompi no entregó los tokens de aceptación; intenta de nuevo');
      }
      cacheInfo = {
        valor: { urlReglamento: tokens.urlReglamento, urlDatosPersonales: tokens.urlDatosPersonales },
        vence: ahora() + DIEZ_MINUTOS,
      };
      return tokens;
    },

    /** Bancos PSE (cache 1 h). Se quita el "A continuacion seleccione su banco" (codigo 0). */
    async bancosPse() {
      if (cacheBancos && cacheBancos.vence > ahora()) return cacheBancos.valor;
      const json = await llamar('GET', '/pse/financial_institutions', { autorizacion: llavePublica });
      const bancos = (json?.data ?? [])
        .map((b) => ({ codigo: String(b.financial_institution_code ?? ''), nombre: String(b.financial_institution_name ?? '') }))
        .filter((b) => b.codigo && b.codigo !== '0');
      cacheBancos = { valor: bancos, vence: ahora() + UNA_HORA };
      return bancos;
    },

    /**
     * POST /transactions para PSE. `tokens` son los de obtenerTokensAceptacion().
     * El telefono ya viene con indicativo 57 y sin '+'.
     */
    async crearTransaccionPse({
      referencia,
      montoCentavos,
      email,
      nombreCompleto,
      telefono,
      tipoPersona,
      tipoDocumento,
      numeroDocumento,
      codigoBanco,
      descripcion,
      urlRedireccion,
      ip,
      tokens,
    }) {
      const cuerpo = {
        acceptance_token: tokens.tokenReglamento,
        accept_personal_auth: tokens.tokenDatosPersonales,
        amount_in_cents: montoCentavos,
        currency: 'COP',
        signature: firmaIntegridad({ referencia, montoCentavos }, secretoIntegridad),
        customer_email: email,
        reference: referencia,
        redirect_url: urlRedireccion,
        ...(ip ? { ip } : {}),
        customer_data: { full_name: nombreCompleto, phone_number: telefono },
        payment_method: {
          type: 'PSE',
          user_type: tipoPersona,
          user_legal_id_type: tipoDocumento,
          user_legal_id: numeroDocumento,
          financial_institution_code: codigoBanco,
          payment_description: String(descripcion).slice(0, 30),
        },
      };
      const json = await llamar('POST', '/transactions', { autorizacion: llavePrivada, cuerpo });
      return json?.data ?? null;
    },

    /** GET /transactions/{id} con la llave privada. null si Wompi no la conoce. */
    obtenerTransaccion,

    /** Todas las transacciones con esa referencia (puede haber varias por el reintento del checkout). */
    async buscarPorReferencia(referencia) {
      const json = await llamar('GET', `/transactions?reference=${encodeURIComponent(referencia)}`, {
        autorizacion: llavePrivada,
      });
      return Array.isArray(json?.data) ? json.data : [];
    },

    /**
     * Consulta la transaccion cada ~1.5 s hasta que aparezca la URL del banco o
     * deje de estar PENDING. Si se acaba el plazo devuelve url null (el
     * frontend sigue consultando con ConsultarPago).
     */
    async esperarUrlPse(id, { intervaloMs = 1500, plazoTotalMs = 20000 } = {}) {
      const limite = ahora() + plazoTotalMs;
      let ultima = null;
      for (;;) {
        ultima = (await obtenerTransaccion(id)) ?? ultima;
        const url = ultima?.payment_method?.extra?.async_payment_url ?? null;
        if (url || (ultima && ultima.status !== 'PENDING')) return { url, tx: ultima };
        if (ahora() + intervaloMs > limite) return { url: null, tx: ultima };
        await esperar(intervaloMs);
      }
    },

    urlCheckout({ referencia, montoCentavos, urlRedireccion, email, nombreCompleto }) {
      return armarUrlCheckout({
        llavePublica,
        secretoIntegridad,
        referencia,
        montoCentavos,
        urlRedireccion,
        email,
        nombreCompleto,
      });
    },
  };
}
