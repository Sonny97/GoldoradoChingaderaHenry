/**
 * Reglas de negocio de los pagos (recargas con Wompi).
 *
 * Fabrica con dependencias inyectadas (repositorio, pasarela, clientes gRPC,
 * reloj) para que las pruebas corran el flujo completo sin red ni base.
 *
 * Principios (docs/WOMPI.md):
 * - El pago se GUARDA (PENDIENTE) antes de llamar a Wompi: si Wompi no
 *   responde, la referencia ya existe y la conciliacion la puede buscar.
 * - Nunca se confia en el navegador: el estado sale de la API de Wompi (llave
 *   privada) o de un webhook con checksum valido, y ademas la transaccion debe
 *   coincidir con NUESTRO registro (referencia, centavos exactos, COP).
 * - aplicarEstadoWompi es la UNICA puerta de entrada de un estado de Wompi:
 *   la usan la consulta del usuario, el webhook, la conciliacion y el modo
 *   simulado. Asi el saldo se acredita una sola vez sin importar por donde
 *   llegue la noticia (ademas AcreditarDeposito es idempotente por referencia).
 * - El libro de MongoDB y los eventos de seguridad son best-effort: si
 *   ms-transacciones esta caido el pago sigue y queda `libroPendiente` para
 *   que la conciliacion lo reintente.
 */

import { randomBytes } from 'node:crypto';
import {
  CODIGOS,
  aFechaHoraIso,
  formatearCOP,
  invalido,
  llamadaOpcional,
  noAutenticado,
  noDisponible,
  noEncontrado,
  sinPermiso,
} from '@goldorado/comun';
import { eventoValido, sha256Hex } from '../wompi/firmas.js';
import { ESTADOS, METODOS, diferenciasConWompi, estadoDesdeWompi, estadoLibro } from './estados.js';

export const MONTO_MINIMO_WOMPI = 1500;
export const MONTOS_SUGERIDOS = Object.freeze([20000, 50000, 100000, 200000]);
export const TIPOS_DOCUMENTO = Object.freeze(['RC', 'TI', 'CC', 'TE', 'CE', 'NIT', 'PP', 'DNI', 'PPT', 'PA']);
export const MENSAJE_CONSENTIMIENTO = 'Debes aceptar el reglamento y la autorización de datos personales de Wompi';
const DESCRIPCION_PSE = 'Recarga GolDorado';
const MINUTO = 60 * 1000;
// Un pago sin ninguna transaccion en Wompi despues de esto se da por abandonado.
const VENCIMIENTO_SIN_TRANSACCION_MS = 24 * 60 * MINUTO;

const EJECUTOR_LIBRO = Object.freeze({
  WEBHOOK: 'WOMPI_WEBHOOK',
  CONCILIACION: 'MS_PAGOS_CONCILIACION',
});

// ErrorNegocio propio trae `codigo`; el error de un cliente gRPC trae `code`.
const codigoDe = (error) => error?.codigo ?? error?.code;
const limpio = (valor) => (typeof valor === 'string' ? valor.trim() : '');
const agregarId = (lista, id) => (!id || (lista ?? []).includes(id) ? [...(lista ?? [])] : [...(lista ?? []), id]);

/** Solo lo que sirve como evidencia; sin datos personales del pagador. */
function payloadTx(tx) {
  if (!tx) return undefined;
  return JSON.stringify({
    id: tx.id,
    reference: tx.reference,
    amount_in_cents: tx.amount_in_cents,
    currency: tx.currency,
    status: tx.status,
    status_message: tx.status_message ?? null,
    payment_method_type: tx.payment_method_type ?? null,
    created_at: tx.created_at ?? null,
    finalized_at: tx.finalized_at ?? null,
  });
}

/**
 * @param {object} o
 * @param {object} o.repo           pagoRepoMemoria | pagoRepoFirestore
 * @param {object} o.pasarela       wompi/cliente.js | wompi/simulado.js
 * @param {{ acreditarDeposito: Function }} o.apuestas
 * @param {{ registrarTransaccion: Function, actualizarEstadoTransaccion: Function, registrarEventoSeguridad: Function }} o.transacciones
 * @param {object} o.log
 * @param {{ montoMinimo?: number, montoMaximo?: number, secretoEventos?: string, ambiente?: string }} o.config
 * @param {() => Date} [o.ahora]
 * @param {() => string} [o.aleatorio]  4 caracteres hex
 */
export function crearServicioPagos({
  repo,
  pasarela,
  apuestas,
  transacciones,
  log,
  config = {},
  ahora = () => new Date(),
  aleatorio = () => randomBytes(2).toString('hex'),
}) {
  const montoMinimo = Math.max(MONTO_MINIMO_WOMPI, Number(config.montoMinimo ?? 5000));
  const montoMaximo = Math.max(montoMinimo, Number(config.montoMaximo ?? 3000000));
  const ambiente = config.ambiente ?? pasarela.modo;

  // ------------------------------------------------------------ validaciones
  function validarUsuario(idUsuario) {
    const id = Number(idUsuario);
    if (!Number.isInteger(id) || id <= 0) throw invalido('Usuario inválido');
    return id;
  }

  function validarMonto(monto) {
    const valor = Number(monto);
    if (!Number.isInteger(valor) || valor < montoMinimo || valor > montoMaximo) {
      throw invalido(
        `El monto debe ser un valor entero entre ${formatearCOP(montoMinimo)} y ${formatearCOP(montoMaximo)}`
      );
    }
    return valor;
  }

  function validarUrlRetorno(url) {
    try {
      const u = new URL(limpio(url));
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    } catch {
      /* cae al error de abajo */
    }
    throw invalido('La URL de retorno no es válida');
  }

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validarPagadorPse(pagador) {
    const email = limpio(pagador?.email).toLowerCase();
    if (!EMAIL.test(email) || email.length > 120) throw invalido('Ingresa un correo válido');
    const nombreCompleto = limpio(pagador?.nombreCompleto).replace(/\s+/g, ' ');
    if (nombreCompleto.length < 3 || nombreCompleto.length > 100) throw invalido('Ingresa el nombre completo del pagador');
    let telefono = String(pagador?.telefono ?? '').replace(/\D/g, '');
    if (telefono.length === 12 && telefono.startsWith('57')) telefono = telefono.slice(2);
    if (telefono.length !== 10) throw invalido('Ingresa un teléfono de 10 dígitos');
    const tipoDocumento = limpio(pagador?.tipoDocumento).toUpperCase();
    if (!TIPOS_DOCUMENTO.includes(tipoDocumento)) throw invalido('Tipo de documento no válido');
    const numeroDocumento = limpio(pagador?.numeroDocumento);
    if (!/^[A-Za-z0-9]{3,20}$/.test(numeroDocumento)) throw invalido('Ingresa un número de documento válido');
    return { email, nombreCompleto, telefono: `57${telefono}`, tipoDocumento, numeroDocumento };
  }

  /** En el Web Checkout Wompi pide sus propios datos: los nuestros solo precargan el formulario. */
  function validarPagadorCheckout(pagador) {
    const email = limpio(pagador?.email).toLowerCase();
    if (email && !EMAIL.test(email)) throw invalido('Ingresa un correo válido');
    const nombreCompleto = limpio(pagador?.nombreCompleto).replace(/\s+/g, ' ').slice(0, 100);
    return { email, nombreCompleto, telefono: '', tipoDocumento: limpio(pagador?.tipoDocumento).toUpperCase(), numeroDocumento: limpio(pagador?.numeroDocumento) };
  }

  function urlConReferencia(urlRetorno, referencia) {
    const u = new URL(urlRetorno);
    u.searchParams.set('referencia', referencia);
    return u.toString();
  }

  const nuevaReferencia = (idUsuario) => `GD-${idUsuario}-${ahora().getTime()}-${aleatorio()}`;

  const evento = (tipo, origen, datos = {}) => ({
    tipo,
    origen,
    estadoAnterior: datos.estadoAnterior ?? null,
    estadoNuevo: datos.estadoNuevo ?? null,
    ...(datos.idTransaccionWompi ? { idTransaccionWompi: datos.idTransaccionWompi } : {}),
    ...(datos.estadoWompi ? { estadoWompi: datos.estadoWompi } : {}),
    ...(datos.detalle ? { detalle: datos.detalle } : {}),
    ...(datos.payload ? { payload: datos.payload } : {}),
    fecha: ahora(),
  });

  function nuevoPago({ referencia, idUsuario, monto, metodo, urlPago, urlRedireccion, banco, tipoPersona, pagador }) {
    const momento = ahora();
    return {
      referencia,
      idUsuario,
      monto,
      montoCentavos: monto * 100,
      moneda: 'COP',
      metodo,
      estado: ESTADOS.PENDIENTE,
      mensajeEstado: null,
      idTransaccionWompi: null,
      idsTransaccionWompi: [],
      idTransaccionAprobada: null,
      aprobacionesDuplicadas: [],
      urlPago: urlPago ?? null,
      urlRedireccion,
      banco: banco ?? null,
      tipoPersona: tipoPersona ?? null,
      pagador,
      medioWompi: metodo === 'PSE' ? 'PSE' : null,
      ambiente,
      acreditado: false,
      acreditadoEn: null,
      libroPendiente: false,
      libroEstado: null,
      creadoEn: momento,
      actualizadoEn: momento,
    };
  }

  // ---------------------------------------------------- auditoria (best-effort)
  function seguridad(tipo, severidad, { idUsuario, detalle }) {
    return llamadaOpcional(
      transacciones.registrarEventoSeguridad({
        tipo,
        severidad,
        ...(idUsuario ? { idUsuario } : {}),
        detalle: JSON.stringify(detalle ?? {}),
        origen: 'ms-pagos',
      }),
      log,
      `Evento de seguridad ${tipo}`
    );
  }

  /**
   * Lleva el movimiento del libro (MongoDB) al estado del pago. La primera vez
   * lo registra (idempotente por codigo = referencia); despues solo agrega el
   * cambio de estado. Si falla, marca libroPendiente y la conciliacion reintenta.
   */
  async function sincronizarLibro(pago, { origen = 'CONSULTA', payload, codigoError } = {}) {
    const objetivo = estadoLibro(pago.estado);
    if (pago.libroEstado === objetivo && !pago.libroPendiente) return pago;

    const registrar = () =>
      transacciones.registrarTransaccion({
        codigo: pago.referencia,
        idUsuario: pago.idUsuario,
        tipo: 'DEPOSITO',
        estado: objetivo,
        monto: pago.monto,
        moneda: 'COP',
        origen: 'ms-pagos',
        ...(pago.idTransaccionWompi ? { referenciaExterna: pago.idTransaccionWompi } : {}),
        proveedor: 'Wompi',
        metodo: pago.medioWompi || pago.metodo,
        ejecutadoPor: 'MS_PAGOS',
        ...(payload ? { payload } : {}),
        fecha: aFechaHoraIso(pago.creadoEn) ?? undefined,
      });

    try {
      if (!pago.libroEstado) {
        await registrar();
      } else if (pago.libroEstado !== objetivo) {
        try {
          await transacciones.actualizarEstadoTransaccion({
            codigo: pago.referencia,
            estadoNuevo: objetivo,
            ejecutadoPor: EJECUTOR_LIBRO[origen] ?? 'MS_PAGOS',
            ...(codigoError ? { codigoError } : {}),
            ...(payload ? { payload } : {}),
          });
        } catch (error) {
          // El libro perdio el movimiento (o nunca lo tuvo): se registra de nuevo.
          if (codigoDe(error) !== CODIGOS.NOT_FOUND) throw error;
          await registrar();
        }
      }
      const t = await repo.transicion(pago.referencia, () => ({ cambios: { libroEstado: objetivo, libroPendiente: false } }));
      return t?.despues ?? { ...pago, libroEstado: objetivo, libroPendiente: false };
    } catch (error) {
      log.aviso(`Libro de ms-transacciones sin actualizar para ${pago.referencia} (${objetivo}): ${error?.details ?? error?.message}`);
      if (pago.libroPendiente) return pago;
      const t = await repo.transicion(pago.referencia, () => ({ cambios: { libroPendiente: true } }));
      return t?.despues ?? { ...pago, libroPendiente: true };
    }
  }

  /**
   * Suma el saldo en ms-apuestas si el pago esta APROBADO y aun no acreditado.
   * Si dos caminos llegan a la vez, ambos pueden llamar a AcreditarDeposito:
   * ms-apuestas aplica uno y al otro le responde aplicado=false (UNIQUE por
   * referencia), y los dos dejan acreditado=true. Nunca se suma dos veces.
   */
  async function acreditar(pago, origen) {
    if (pago.estado !== ESTADOS.APROBADO || pago.acreditado) return { pago, error: null };
    try {
      const respuesta = await apuestas.acreditarDeposito({
        idUsuario: pago.idUsuario,
        monto: pago.monto,
        referencia: pago.referencia,
        proveedor: 'Wompi',
        metodo: pago.medioWompi || pago.metodo,
        idTransaccionPasarela: pago.idTransaccionAprobada ?? pago.idTransaccionWompi ?? '',
      });
      const t = await repo.transicion(pago.referencia, (actual) =>
        actual.acreditado
          ? null
          : {
              cambios: { acreditado: true, acreditadoEn: ahora() },
              evento: evento('ACREDITADO', origen, {
                estadoAnterior: actual.estado,
                estadoNuevo: actual.estado,
                detalle:
                  respuesta?.aplicado === false
                    ? 'ms-apuestas ya lo tenia acreditado (reintento ignorado)'
                    : 'ms-apuestas.AcreditarDeposito aplicado',
              }),
            }
      );
      return { pago: t?.despues ?? { ...pago, acreditado: true }, error: null };
    } catch (error) {
      const motivo = error?.details ?? error?.message ?? String(error);
      log.aviso(`No se pudo acreditar ${pago.referencia} en ms-apuestas (se reintentara): ${motivo}`);
      await repo
        .agregarEvento(pago.referencia, evento('ACREDITACION_FALLIDA', origen, { estadoAnterior: pago.estado, estadoNuevo: pago.estado, detalle: motivo }))
        .catch(() => {});
      return { pago, error };
    }
  }

  /**
   * Aplica una transaccion de Wompi (ya leida de la fuente de verdad) a
   * nuestro pago. Unica funcion que cambia el estado por noticias de Wompi.
   *
   * @returns {Promise<{ pago: object, duplicado: boolean, inconsistente: boolean, errorAcreditacion: Error|null }>}
   */
  async function aplicarEstadoWompi(pago, tx, { origen }) {
    const referencia = pago.referencia;
    const diferencias = diferenciasConWompi(pago, tx);

    // 1. La transaccion no corresponde a nuestro registro: no se acredita nada.
    if (diferencias.length) {
      const t = await repo.transicion(referencia, (actual) => ({
        cambios: actual.acreditado
          ? null
          : {
              estado: ESTADOS.ERROR,
              mensajeEstado: `La transacción de Wompi no coincide con el pago (${diferencias.join(', ')})`,
            },
        evento: evento('INCONSISTENTE', origen, {
          estadoAnterior: actual.estado,
          estadoNuevo: actual.acreditado ? actual.estado : ESTADOS.ERROR,
          idTransaccionWompi: tx?.id,
          estadoWompi: tx?.status,
          detalle: `No coincide: ${diferencias.join(', ')}`,
          payload: payloadTx(tx),
        }),
      }));
      log.error(`Transaccion ${tx?.id} de Wompi NO coincide con ${referencia} (${diferencias.join(', ')}): no se acredita`);
      await seguridad('PAGO_MONTO_INCONSISTENTE', 'CRITICO', {
        idUsuario: pago.idUsuario,
        detalle: {
          referencia,
          idTransaccionWompi: tx?.id ?? null,
          diferencias,
          esperado: { referencia, montoCentavos: pago.montoCentavos, moneda: 'COP' },
          recibido: { referencia: tx?.reference ?? null, montoCentavos: tx?.amount_in_cents ?? null, moneda: tx?.currency ?? null },
        },
      });
      const final = await sincronizarLibro(t?.despues ?? pago, { origen, payload: payloadTx(tx), codigoError: 'PAGO_INCONSISTENTE' });
      return { pago: final, duplicado: false, inconsistente: true, errorAcreditacion: null };
    }

    // 2. Transicion atomica. La funcion puede correr mas de una vez (Firestore
    //    reintenta la transaccion si hubo conflicto): debe ser pura.
    const estadoWompi = estadoDesdeWompi(tx.status);
    let duplicado = false;
    const t = await repo.transicion(referencia, (actual) => {
      duplicado = false;
      const cambios = {};
      const ids = agregarId(actual.idsTransaccionWompi, tx.id);
      if (ids.length !== (actual.idsTransaccionWompi ?? []).length) cambios.idsTransaccionWompi = ids;
      const aprobada = actual.idTransaccionAprobada ?? null;

      if (aprobada && aprobada !== tx.id) {
        // Ya hay OTRA transaccion aprobada para esta referencia (reintento del
        // checkout): esta no cambia el estado ni se acredita.
        const yaMarcadas = actual.aprobacionesDuplicadas ?? [];
        if (estadoWompi === ESTADOS.APROBADO && !yaMarcadas.includes(tx.id)) {
          duplicado = true;
          cambios.aprobacionesDuplicadas = [...yaMarcadas, tx.id];
        }
      } else {
        let estado = estadoWompi;
        // La transaccion aprobada solo puede pasar a ANULADO (tarjetas).
        if (aprobada === tx.id && estado !== ESTADOS.APROBADO && estado !== ESTADOS.ANULADO) estado = actual.estado;
        if (estado !== actual.estado) cambios.estado = estado;
        if (estado === ESTADOS.APROBADO && !aprobada) cambios.idTransaccionAprobada = tx.id;
        if (actual.idTransaccionWompi !== tx.id) cambios.idTransaccionWompi = tx.id;
        const mensaje = tx.status_message ?? null;
        if (mensaje !== (actual.mensajeEstado ?? null)) cambios.mensajeEstado = mensaje;
        if (tx.payment_method_type && tx.payment_method_type !== actual.medioWompi) cambios.medioWompi = tx.payment_method_type;
        const url = tx.payment_method?.extra?.async_payment_url;
        if (url && !actual.urlPago) cambios.urlPago = url;
      }

      const hayCambios = Object.keys(cambios).length > 0;
      if (!hayCambios && origen !== 'WEBHOOK') return null; // una consulta repetida no llena el historial
      return {
        cambios: hayCambios ? cambios : null,
        evento: evento(duplicado ? 'APROBACION_DUPLICADA' : 'ESTADO_WOMPI', origen, {
          estadoAnterior: actual.estado,
          estadoNuevo: cambios.estado ?? actual.estado,
          idTransaccionWompi: tx.id,
          estadoWompi: tx.status,
          payload: payloadTx(tx),
        }),
      };
    });
    if (!t) throw noEncontrado('Pago no encontrado');
    let final = t.despues;

    if (duplicado) {
      log.aviso(`Segunda transaccion APPROVED (${tx.id}) para ${referencia}: NO se acredita, queda para devolucion manual`);
      await seguridad('PAGO_DUPLICADO_REVISION', 'ADVERTENCIA', {
        idUsuario: pago.idUsuario,
        detalle: { referencia, idTransaccionWompi: tx.id, idTransaccionAcreditada: final.idTransaccionAprobada, montoCentavos: tx.amount_in_cents },
      });
    }
    if (t.antes.estado === ESTADOS.APROBADO && final.estado === ESTADOS.ANULADO && final.acreditado) {
      await seguridad('PAGO_ANULADO_REVISION', 'ADVERTENCIA', {
        idUsuario: pago.idUsuario,
        detalle: { referencia, idTransaccionWompi: tx.id, detalle: 'Wompi anulo un pago ya acreditado' },
      });
    }

    // 3. Acreditar (una vez) y 4. reflejarlo en el libro.
    const { pago: acreditado, error } = await acreditar(final, origen);
    final = acreditado;
    const codigoError = [ESTADOS.RECHAZADO, ESTADOS.ERROR].includes(final.estado) ? `WOMPI_${tx.status}` : undefined;
    final = await sincronizarLibro(final, { origen, payload: payloadTx(tx), codigoError });
    return { pago: final, duplicado, inconsistente: false, errorAcreditacion: error };
  }

  /** De varias transacciones con la misma referencia: las aprobadas, o la mas reciente. */
  function elegirTransacciones(lista) {
    const ordenadas = [...(lista ?? [])].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    const aprobadas = ordenadas.filter((tx) => tx.status === 'APPROVED');
    if (aprobadas.length) return aprobadas;
    return ordenadas.length ? [ordenadas[ordenadas.length - 1]] : [];
  }

  /** Lo que Wompi sabe de este pago: por id si lo conocemos, si no por referencia. */
  async function transaccionesDeWompi(pago, idTransaccion) {
    const id = idTransaccion || pago.idTransaccionWompi;
    if (id) {
      const tx = await pasarela.obtenerTransaccion(id);
      return tx ? [tx] : [];
    }
    return elegirTransacciones(await pasarela.buscarPorReferencia(pago.referencia));
  }

  async function aplicarVarias(pago, lista, origen) {
    let resultado = { pago, duplicado: false, inconsistente: false, errorAcreditacion: null };
    for (const tx of lista) {
      const r = await aplicarEstadoWompi(resultado.pago, tx, { origen });
      resultado = { ...r, errorAcreditacion: r.errorAcreditacion ?? resultado.errorAcreditacion };
    }
    return resultado;
  }

  async function marcarError(pago, error, origen = 'CREACION') {
    const mensaje = error?.message ?? 'Wompi rechazó el pago';
    const t = await repo.transicion(pago.referencia, (actual) => ({
      cambios: { estado: ESTADOS.ERROR, mensajeEstado: mensaje },
      evento: evento('ERROR_WOMPI', origen, { estadoAnterior: actual.estado, estadoNuevo: ESTADOS.ERROR, detalle: mensaje }),
    }));
    await sincronizarLibro(t?.despues ?? pago, { origen, codigoError: 'WOMPI_RECHAZO' });
  }

  async function resolverBanco(codigo) {
    let bancos;
    try {
      bancos = await pasarela.bancosPse();
    } catch (error) {
      log.aviso(`No se pudo leer la lista de bancos PSE (se sigue con el codigo ${codigo}): ${error?.message}`);
      return { codigo, nombre: '' };
    }
    const banco = bancos.find((b) => b.codigo === codigo);
    if (!banco && bancos.length) throw invalido('Selecciona un banco de la lista');
    return banco ? { codigo: banco.codigo, nombre: banco.nombre } : { codigo, nombre: '' };
  }

  function exigirPasarelaConfigurada() {
    if (pasarela.modo !== 'simulado' && !pasarela.llavePublica) {
      throw noDisponible('La pasarela de pagos no está configurada');
    }
  }

  // =================================================================== RPCs
  return {
    aplicarEstadoWompi,
    sincronizarLibro,
    acreditar,

    async obtenerConfiguracion() {
      let info = { urlReglamento: '', urlDatosPersonales: '' };
      try {
        info = { ...info, ...(await pasarela.obtenerInfoComercio()) };
      } catch (error) {
        log.aviso(`Sin permalinks de Wompi (la configuracion sale sin ellos): ${error?.message}`);
      }
      return {
        modo: pasarela.modo,
        llavePublica: pasarela.llavePublica ?? '',
        moneda: 'COP',
        montoMinimo,
        montoMaximo,
        metodos: [...METODOS],
        montosSugeridos: [...MONTOS_SUGERIDOS],
        urlReglamento: info.urlReglamento ?? '',
        urlDatosPersonales: info.urlDatosPersonales ?? '',
      };
    },

    async listarBancosPse() {
      exigirPasarelaConfigurada();
      return pasarela.bancosPse();
    },

    async crearPagoPse(req) {
      const idUsuario = validarUsuario(req.idUsuario);
      if (req.aceptaReglamento !== true || req.aceptaDatosPersonales !== true) throw invalido(MENSAJE_CONSENTIMIENTO);
      const monto = validarMonto(req.monto);
      const codigoBanco = limpio(req.codigoBanco);
      if (!codigoBanco || codigoBanco === '0') throw invalido('Selecciona tu banco');
      const tipoPersona = Number(req.tipoPersona ?? 0);
      if (tipoPersona !== 0 && tipoPersona !== 1) throw invalido('Tipo de persona no válido (0 = natural, 1 = jurídica)');
      const pagador = validarPagadorPse(req.pagador);
      const urlRetorno = validarUrlRetorno(req.urlRetorno);
      exigirPasarelaConfigurada();
      const banco = await resolverBanco(codigoBanco);

      const referencia = nuevaReferencia(idUsuario);
      const urlRedireccion = urlConReferencia(urlRetorno, referencia);
      // 1. Primero NUESTRO registro.
      let pago = await repo.crear(
        nuevoPago({ referencia, idUsuario, monto, metodo: 'PSE', urlRedireccion, banco, tipoPersona, pagador }),
        evento('CREADO', 'CREACION', { estadoNuevo: ESTADOS.PENDIENTE, detalle: `PSE ${banco.nombre || banco.codigo}` })
      );

      // 2. Tokens de aceptacion NUEVOS (un solo uso). Sin ellos no hay transaccion.
      let tokens;
      try {
        tokens = await pasarela.obtenerTokensAceptacion();
      } catch (error) {
        await marcarError(pago, error);
        throw error;
      }

      // 3. Transaccion en Wompi.
      let tx;
      try {
        tx = await pasarela.crearTransaccionPse({
          referencia,
          montoCentavos: pago.montoCentavos,
          email: pagador.email,
          nombreCompleto: pagador.nombreCompleto,
          telefono: pagador.telefono,
          tipoPersona,
          tipoDocumento: pagador.tipoDocumento,
          numeroDocumento: pagador.numeroDocumento,
          codigoBanco,
          descripcion: DESCRIPCION_PSE,
          urlRedireccion,
          ip: limpio(req.ip) || undefined,
          tokens,
        });
        if (!tx?.id) throw noDisponible('Wompi no responde en este momento');
      } catch (error) {
        if (codigoDe(error) === CODIGOS.INVALID_ARGUMENT) {
          await marcarError(pago, error);
          throw error;
        }
        // Sin respuesta: Wompi pudo haberla creado. Queda PENDIENTE y la
        // conciliacion la busca por referencia.
        await repo
          .agregarEvento(referencia, evento('CREACION_SIN_RESPUESTA', 'CREACION', { estadoAnterior: ESTADOS.PENDIENTE, estadoNuevo: ESTADOS.PENDIENTE, detalle: error?.message }))
          .catch(() => {});
        await sincronizarLibro(pago, { origen: 'CREACION' });
        throw error;
      }

      const t = await repo.transicion(referencia, (actual) => ({
        cambios: { idTransaccionWompi: tx.id, idsTransaccionWompi: agregarId(actual.idsTransaccionWompi, tx.id) },
        evento: evento('TRANSACCION_CREADA', 'CREACION', {
          estadoAnterior: actual.estado,
          estadoNuevo: actual.estado,
          idTransaccionWompi: tx.id,
          estadoWompi: tx.status,
          payload: payloadTx(tx),
        }),
      }));
      pago = t?.despues ?? pago;

      // 4. Esperar la URL del banco (async_payment_url no viene al crear).
      let espera = { url: null, tx: null };
      try {
        espera = await pasarela.esperarUrlPse(tx.id);
      } catch (error) {
        log.aviso(`Sin URL del banco todavia para ${referencia}: ${error?.message}`);
      }
      if (espera.tx) {
        pago = (await aplicarEstadoWompi(pago, espera.tx, { origen: 'CREACION' })).pago;
      } else if (espera.url) {
        pago = (await repo.transicion(referencia, () => ({ cambios: { urlPago: espera.url } })))?.despues ?? pago;
      }

      // 5. Libro de movimientos (PENDIENTE), si aplicarEstadoWompi no lo hizo ya.
      return sincronizarLibro(pago, { origen: 'CREACION' });
    },

    async crearPagoCheckout(req) {
      const idUsuario = validarUsuario(req.idUsuario);
      const monto = validarMonto(req.monto);
      const pagador = validarPagadorCheckout(req.pagador);
      const urlRetorno = validarUrlRetorno(req.urlRetorno);
      exigirPasarelaConfigurada();

      const referencia = nuevaReferencia(idUsuario);
      const urlRedireccion = urlConReferencia(urlRetorno, referencia);
      // La URL es pura (firma calculada aqui), asi que se guarda junto con el pago.
      const urlPago = pasarela.urlCheckout({
        referencia,
        montoCentavos: monto * 100,
        urlRedireccion,
        email: pagador.email,
        nombreCompleto: pagador.nombreCompleto,
      });
      const pago = await repo.crear(
        nuevoPago({ referencia, idUsuario, monto, metodo: 'CHECKOUT', urlPago, urlRedireccion, pagador }),
        evento('CREADO', 'CREACION', { estadoNuevo: ESTADOS.PENDIENTE, detalle: 'Web Checkout' })
      );
      return sincronizarLibro(pago, { origen: 'CREACION' });
    },

    async consultarPago({ referencia, idTransaccionWompi, idUsuario }) {
      const ref = limpio(referencia);
      const idTx = limpio(idTransaccionWompi);
      if (!ref && !idTx) throw invalido('Indica la referencia del pago');

      let pago = null;
      let txConocida = null;
      if (ref) {
        pago = await repo.obtener(ref);
      } else {
        pago = await repo.buscarPorIdWompi(idTx);
        if (!pago) {
          // Id que no conocemos (vuelta del checkout): se le pregunta a Wompi de que referencia es.
          txConocida = await pasarela.obtenerTransaccion(idTx);
          if (txConocida?.reference) pago = await repo.obtener(txConocida.reference);
        }
      }
      if (!pago) throw noEncontrado('Pago no encontrado');
      if (idUsuario && Number(idUsuario) !== pago.idUsuario) throw sinPermiso('No puedes consultar ese pago');

      const idNuevo = Boolean(idTx) && !(pago.idsTransaccionWompi ?? []).includes(idTx);
      if (pago.estado === ESTADOS.PENDIENTE || idNuevo) {
        try {
          const lista = txConocida ? [txConocida] : await transaccionesDeWompi(pago, idNuevo ? idTx : undefined);
          pago = (await aplicarVarias(pago, lista, 'CONSULTA')).pago;
        } catch (error) {
          // Wompi caido: el usuario ve el ultimo estado conocido y sigue consultando.
          log.aviso(`No se pudo refrescar ${pago.referencia} con Wompi: ${error?.details ?? error?.message}`);
        }
      } else if (pago.estado === ESTADOS.APROBADO && !pago.acreditado) {
        pago = (await acreditar(pago, 'CONSULTA')).pago;
      }
      return pago;
    },

    async listarPagos({ idUsuario, limite }) {
      const id = validarUsuario(idUsuario);
      const n = Number(limite) > 0 ? Math.min(Number(limite), 100) : 20;
      return repo.listarPorUsuario(id, n);
    },

    async procesarEventoWompi({ cuerpoJson, checksumCabecera }) {
      let ev;
      try {
        ev = JSON.parse(String(cuerpoJson ?? ''));
      } catch {
        throw invalido('El evento de Wompi no es JSON válido');
      }
      if (!ev || typeof ev !== 'object') throw invalido('El evento de Wompi no es JSON válido');
      const txEvento = ev.data?.transaction ?? {};

      if (!config.secretoEventos) log.error('WOMPI_SECRETO_EVENTOS esta vacio: ningun webhook se puede verificar');
      if (!eventoValido(ev, config.secretoEventos, limpio(checksumCabecera))) {
        await seguridad('WEBHOOK_FIRMA_INVALIDA', 'CRITICO', {
          detalle: {
            evento: ev.event ?? null,
            environment: ev.environment ?? null,
            referencia: txEvento.reference ?? null,
            idTransaccionWompi: txEvento.id ?? null,
          },
        });
        throw noAutenticado('Firma del evento inválida');
      }

      if (ev.environment !== pasarela.ambienteEventos) {
        log.aviso(`Evento de Wompi del ambiente "${ev.environment}" ignorado (este servicio espera "${pasarela.ambienteEventos}")`);
        return { aceptado: true, referencia: txEvento.reference ?? '', estado: '' };
      }
      if (ev.event !== 'transaction.updated' || !txEvento.id) {
        log.info(`Evento de Wompi "${ev.event}" ignorado`);
        return { aceptado: true, referencia: '', estado: '' };
      }

      const idEvento = sha256Hex(String(limpio(checksumCabecera) || ev.signature?.checksum || '').toLowerCase());
      const { procesado } = await repo.reservarEventoWompi(idEvento, {
        evento: ev.event,
        environment: ev.environment,
        idTransaccionWompi: txEvento.id,
        referencia: txEvento.reference ?? null,
        estadoWompi: txEvento.status ?? null,
        timestamp: ev.timestamp ?? null,
        cuerpo: String(cuerpoJson),
      });
      if (procesado) {
        const existente = txEvento.reference ? await repo.obtener(txEvento.reference) : null;
        return { aceptado: true, referencia: txEvento.reference ?? '', estado: existente?.estado ?? '' };
      }

      // Fuente de verdad: la transaccion leida con la llave privada (no el cuerpo del evento).
      const tx = await pasarela.obtenerTransaccion(txEvento.id);
      if (!tx) {
        log.aviso(`Webhook de Wompi con una transaccion que la API no conoce: ${txEvento.id}`);
        await repo.marcarEventoWompiProcesado(idEvento, { resultado: 'TRANSACCION_DESCONOCIDA' });
        return { aceptado: true, referencia: txEvento.reference ?? '', estado: '' };
      }
      const pago = await repo.obtener(tx.reference);
      if (!pago) {
        log.aviso(`Webhook de Wompi para una referencia que no es de GolDorado: ${tx.reference}`);
        await repo.marcarEventoWompiProcesado(idEvento, { resultado: 'REFERENCIA_DESCONOCIDA' });
        return { aceptado: true, referencia: tx.reference ?? '', estado: '' };
      }

      const r = await aplicarEstadoWompi(pago, tx, { origen: 'WEBHOOK' });
      if (r.errorAcreditacion) {
        // 503 en el BFF -> Wompi reintenta (+30 min, +3 h, +24 h); la conciliacion tambien.
        throw noDisponible('No se pudo acreditar el pago todavía; se reintentará');
      }
      await repo.marcarEventoWompiProcesado(idEvento, { resultado: r.pago.estado, referencia: tx.reference });
      return { aceptado: true, referencia: tx.reference, estado: r.pago.estado };
    },

    /**
     * Una ronda de conciliacion:
     *  - PENDIENTE con mas de `minutosPendiente` -> se pregunta a Wompi;
     *  - APROBADO sin acreditar -> se reintenta AcreditarDeposito;
     *  - libroPendiente -> se reintenta el libro de MongoDB.
     */
    async conciliar({ minutosPendiente = 2, limite = 50 } = {}) {
      const resumen = { revisados: 0, acreditados: 0, libro: 0, errores: 0 };
      const corte = new Date(ahora().getTime() - minutosPendiente * MINUTO);

      for (const pago of await repo.listarPendientesAntesDe(corte, limite)) {
        try {
          const lista = await transaccionesDeWompi(pago);
          if (lista.length) {
            await aplicarVarias(pago, lista, 'CONCILIACION');
          } else if (ahora().getTime() - new Date(pago.creadoEn).getTime() > VENCIMIENTO_SIN_TRANSACCION_MS) {
            const t = await repo.transicion(pago.referencia, (actual) =>
              actual.estado !== ESTADOS.PENDIENTE
                ? null
                : {
                    cambios: { estado: ESTADOS.ERROR, mensajeEstado: 'El pago venció sin que Wompi registrara una transacción' },
                    evento: evento('VENCIDO', 'CONCILIACION', { estadoAnterior: actual.estado, estadoNuevo: ESTADOS.ERROR }),
                  }
            );
            if (t?.despues) await sincronizarLibro(t.despues, { origen: 'CONCILIACION', codigoError: 'VENCIDO' });
          }
          resumen.revisados += 1;
        } catch (error) {
          resumen.errores += 1;
          log.aviso(`Conciliacion de ${pago.referencia}: ${error?.details ?? error?.message}`);
        }
      }

      for (const pago of await repo.listarAprobadosSinAcreditar(limite)) {
        const r = await acreditar(pago, 'CONCILIACION');
        if (r.error) resumen.errores += 1;
        else resumen.acreditados += 1;
      }

      for (const pago of await repo.listarLibroPendiente(limite)) {
        const p = await sincronizarLibro(pago, { origen: 'CONCILIACION' });
        if (p.libroPendiente) resumen.errores += 1;
        else resumen.libro += 1;
      }
      return resumen;
    },
  };
}
