/**
 * Dobles de prueba (sin efectos al importarse: node --test ejecuta todo .js
 * bajo test/, asi que este archivo solo exporta fabricas).
 *
 * - apuestasFalso: AcreditarDeposito idempotente por referencia, como el real
 *   (UNIQUE en movimiento_saldo): cuenta llamadas y aplicaciones.
 * - transaccionesFalso: libro en un Map + lista de eventos de seguridad.
 * - pasarelaFalsa: "Wompi" controlable desde la prueba (transacciones por id).
 * - logMudo: logger que guarda los mensajes en vez de imprimirlos.
 */

import { CODIGOS, ErrorNegocio } from '@goldorado/comun';
import { checksumEvento } from '../src/wompi/firmas.js';

export const SECRETO_EVENTOS = 'test_events_secreto_de_prueba';

export function logMudo() {
  const mensajes = [];
  const guardar = (nivel) => (...partes) => mensajes.push(`${nivel} ${partes.join(' ')}`);
  return { mensajes, info: guardar('info'), aviso: guardar('aviso'), error: guardar('error'), debug: () => {} };
}

export function apuestasFalso({ fallar = false } = {}) {
  const saldos = new Map();
  const aplicadas = new Set();
  const llamadas = [];
  return {
    llamadas,
    saldos,
    fallar,
    async acreditarDeposito(carga) {
      llamadas.push(carga);
      if (this.fallar) throw new ErrorNegocio(CODIGOS.UNAVAILABLE, 'ms-apuestas no responde');
      if (aplicadas.has(carga.referencia)) return { aplicado: false };
      aplicadas.add(carga.referencia);
      saldos.set(carga.idUsuario, (saldos.get(carga.idUsuario) ?? 0) + carga.monto);
      return { aplicado: true, billetera: { idUsuario: carga.idUsuario, saldoDisponible: saldos.get(carga.idUsuario) } };
    },
  };
}

export function transaccionesFalso({ fallar = false } = {}) {
  const libro = new Map();
  const eventos = [];
  return {
    libro,
    eventos,
    fallar,
    async registrarTransaccion(carga) {
      if (this.fallar) throw new ErrorNegocio(CODIGOS.UNAVAILABLE, 'ms-transacciones no responde');
      const existente = libro.get(carga.codigo);
      if (existente) {
        if (existente.estado !== carga.estado) existente.historial.push(carga.estado);
        existente.estado = carga.estado;
        return existente;
      }
      const nueva = { ...carga, historial: [carga.estado] };
      libro.set(carga.codigo, nueva);
      return nueva;
    },
    async actualizarEstadoTransaccion(carga) {
      if (this.fallar) throw new ErrorNegocio(CODIGOS.UNAVAILABLE, 'ms-transacciones no responde');
      const existente = libro.get(carga.codigo);
      if (!existente) throw new ErrorNegocio(CODIGOS.NOT_FOUND, 'Transacción no encontrada');
      existente.estado = carga.estadoNuevo;
      existente.historial.push(carga.estadoNuevo);
      return existente;
    },
    async registrarEventoSeguridad(evento) {
      eventos.push(evento);
      return {};
    },
  };
}

/** "Wompi" de mentiras: la prueba decide que devuelve cada transaccion. */
export function pasarelaFalsa() {
  const transacciones = new Map();
  let contador = 0;
  return {
    modo: 'sandbox',
    llavePublica: 'pub_test_falsa',
    ambienteEventos: 'test',
    transacciones,
    tokensPedidos: 0,
    async obtenerInfoComercio() {
      return { urlReglamento: 'https://wompi.co/reglamento.pdf', urlDatosPersonales: 'https://wompi.co/datos.pdf' };
    },
    async obtenerTokensAceptacion() {
      this.tokensPedidos += 1;
      return { tokenReglamento: `tok-${this.tokensPedidos}`, tokenDatosPersonales: `per-${this.tokensPedidos}` };
    },
    async bancosPse() {
      return [
        { codigo: '1', nombre: 'Banco que aprueba' },
        { codigo: '2', nombre: 'Banco que declina' },
      ];
    },
    async crearTransaccionPse(datos) {
      contador += 1;
      const tx = {
        id: `11-${contador}`,
        reference: datos.referencia,
        amount_in_cents: datos.montoCentavos,
        currency: 'COP',
        status: 'PENDING',
        payment_method_type: 'PSE',
        payment_method: { type: 'PSE', extra: {} },
        created_at: new Date().toISOString(),
      };
      this.ultimaCreacion = datos;
      transacciones.set(tx.id, tx);
      return { ...tx };
    },
    async esperarUrlPse(id) {
      const tx = transacciones.get(id);
      tx.payment_method.extra.async_payment_url = `https://banco.test/pse?ticket=${id}`;
      return { url: tx.payment_method.extra.async_payment_url, tx: structuredClone(tx) };
    },
    async obtenerTransaccion(id) {
      const tx = transacciones.get(id);
      return tx ? structuredClone(tx) : null;
    },
    async buscarPorReferencia(referencia) {
      return [...transacciones.values()].filter((t) => t.reference === referencia).map((t) => structuredClone(t));
    },
    urlCheckout({ referencia, urlRedireccion }) {
      return `https://checkout.wompi.co/p/?reference=${referencia}&redirect-url=${encodeURIComponent(urlRedireccion)}`;
    },
    /** Cambia el estado de una transaccion "en Wompi". */
    poner(id, cambios) {
      Object.assign(transacciones.get(id), cambios);
    },
    agregar(tx) {
      transacciones.set(tx.id, structuredClone(tx));
    },
  };
}

/** Evento de webhook firmado como lo firmaria Wompi. */
export function eventoFirmado(tx, { secreto = SECRETO_EVENTOS, environment = 'test', timestamp = 1762700000 } = {}) {
  const evento = {
    event: 'transaction.updated',
    data: { transaction: tx },
    environment,
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp,
    sent_at: new Date(timestamp * 1000).toISOString(),
  };
  evento.signature.checksum = checksumEvento(evento, secreto);
  return evento;
}

export const PAGADOR = Object.freeze({
  email: 'demo@goldorado.co',
  nombreCompleto: 'Camilo Rojas',
  telefono: '300 123 4567',
  tipoDocumento: 'CC',
  numeroDocumento: '1012345678',
});

export function solicitudPse(extra = {}) {
  return {
    idUsuario: 1,
    monto: 50000,
    codigoBanco: '1',
    tipoPersona: 0,
    pagador: { ...PAGADOR },
    urlRetorno: 'http://localhost:3003/pagos/resultado',
    ip: '190.1.2.3',
    aceptaReglamento: true,
    aceptaDatosPersonales: true,
    ...extra,
  };
}
