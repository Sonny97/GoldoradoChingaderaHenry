/**
 * Repositorio de pagos EN MEMORIA (PAGOS_ALMACEN=memoria): la misma interfaz
 * que pagoRepoFirestore.js, sobre Maps.
 *
 * Existe para correr la app y las pruebas sin Firebase. Se pierde al reiniciar
 * el proceso (por eso arranca con los dos pagos semilla). La atomicidad de
 * `transicion` sale gratis: JavaScript corre la lectura, la funcion y la
 * escritura en el mismo turno, sin `await` en medio, asi que dos caminos que
 * llegan a la vez (consulta y webhook) se ejecutan uno detras del otro, igual
 * que runTransaction en Firestore.
 *
 * Todo lo que entra y sale se clona: quien llama nunca toca el estado interno.
 */

import { pagosSemilla } from './semilla.js';

const clonar = (valor) => (valor === null || valor === undefined ? valor : structuredClone(valor));
const ms = (fecha) => (fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime());

/** @param {{ semilla?: boolean, ahora?: () => Date }} [opciones] */
export function crearRepoPagosMemoria({ semilla = true, ahora = () => new Date() } = {}) {
  const pagos = new Map();
  const eventos = new Map(); // referencia -> [evento]
  const eventosWompi = new Map(); // id -> { ..., procesado }

  function guardarEvento(referencia, evento) {
    if (!evento) return;
    const lista = eventos.get(referencia) ?? [];
    lista.push(clonar({ ...evento, fecha: evento.fecha ?? ahora() }));
    eventos.set(referencia, lista);
  }

  if (semilla) {
    for (const { pago, eventos: lista } of pagosSemilla(ahora())) {
      pagos.set(pago.referencia, clonar(pago));
      for (const e of lista) guardarEvento(pago.referencia, e);
    }
  }

  const ordenarRecientes = (a, b) => ms(b.creadoEn) - ms(a.creadoEn);

  return {
    almacen: 'memoria',

    async crear(pago, evento) {
      if (pagos.has(pago.referencia)) throw new Error(`El pago ${pago.referencia} ya existe`);
      pagos.set(pago.referencia, clonar(pago));
      guardarEvento(pago.referencia, evento);
      return clonar(pago);
    },

    async obtener(referencia) {
      return clonar(pagos.get(referencia) ?? null);
    },

    async buscarPorIdWompi(idTransaccion) {
      for (const pago of pagos.values()) {
        if ((pago.idsTransaccionWompi ?? []).includes(idTransaccion)) return clonar(pago);
      }
      return null;
    },

    /**
     * Lectura-modificacion-escritura atomica. `fn(actual)` devuelve
     * { cambios, evento } o null (no cambia nada). Resultado: { antes, despues }
     * o null si el pago no existe.
     */
    async transicion(referencia, fn) {
      const actual = pagos.get(referencia);
      if (!actual) return null;
      const antes = clonar(actual);
      const resultado = fn(clonar(actual));
      if (!resultado?.cambios) {
        if (resultado?.evento) guardarEvento(referencia, resultado.evento);
        return { antes, despues: clonar(actual) };
      }
      const despues = { ...actual, ...clonar(resultado.cambios), actualizadoEn: ahora() };
      pagos.set(referencia, despues);
      guardarEvento(referencia, resultado.evento);
      return { antes, despues: clonar(despues) };
    },

    async agregarEvento(referencia, evento) {
      guardarEvento(referencia, evento);
    },

    async listarEventos(referencia) {
      return clonar(eventos.get(referencia) ?? []);
    },

    async listarPorUsuario(idUsuario, limite = 20) {
      return [...pagos.values()]
        .filter((p) => p.idUsuario === idUsuario)
        .sort(ordenarRecientes)
        .slice(0, limite)
        .map(clonar);
    },

    async listarPendientesAntesDe(fecha, limite = 50) {
      return [...pagos.values()]
        .filter((p) => p.estado === 'PENDIENTE' && ms(p.creadoEn) <= ms(fecha))
        .sort((a, b) => ms(a.creadoEn) - ms(b.creadoEn))
        .slice(0, limite)
        .map(clonar);
    },

    async listarAprobadosSinAcreditar(limite = 50) {
      return [...pagos.values()]
        .filter((p) => p.estado === 'APROBADO' && !p.acreditado)
        .slice(0, limite)
        .map(clonar);
    },

    async listarLibroPendiente(limite = 50) {
      return [...pagos.values()]
        .filter((p) => p.libroPendiente === true)
        .slice(0, limite)
        .map(clonar);
    },

    /**
     * Registra un evento crudo de Wompi (id = sha256 del checksum).
     * Devuelve { procesado: true } si ya se habia procesado antes (duplicado).
     */
    async reservarEventoWompi(id, datos) {
      const existente = eventosWompi.get(id);
      if (existente) return { procesado: existente.procesado === true };
      eventosWompi.set(id, clonar({ ...datos, procesado: false, recibidoEn: ahora() }));
      return { procesado: false };
    },

    async marcarEventoWompiProcesado(id, resultado) {
      const existente = eventosWompi.get(id) ?? {};
      eventosWompi.set(id, { ...existente, ...clonar(resultado), procesado: true, procesadoEn: ahora() });
    },

    async comprobar() {
      return true;
    },

    async cerrar() {},
  };
}
