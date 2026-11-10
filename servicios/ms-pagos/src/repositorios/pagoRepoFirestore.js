/**
 * Repositorio de pagos sobre Cloud Firestore (PAGOS_ALMACEN=firestore).
 *
 * Modelo (detalle en db/ESTRUCTURA.md):
 *   pagos/{referencia}             un documento por pago (id = nuestra referencia,
 *                                  asi la idempotencia por referencia es gratis)
 *   pagos/{referencia}/eventos     historial: cada transicion, webhook o consulta
 *   eventos_wompi/{sha256}         webhooks crudos; el id deduplica reintentos
 *
 * Toda lectura-modificacion-escritura del estado y de `acreditado` pasa por
 * runTransaction: si la consulta del usuario y el webhook de Wompi llegan a la
 * vez, Firestore reintenta la segunda con el documento ya actualizado y la
 * funcion de transicion decide de nuevo (por eso debe ser pura).
 *
 * Las consultas usan los indices de db/firestore.indexes.json. Los valores
 * siempre van como parametros de where(): nada se arma concatenando texto.
 */

import { Timestamp } from 'firebase-admin/firestore';

export const COLECCION_PAGOS = 'pagos';
export const SUBCOLECCION_EVENTOS = 'eventos';
export const COLECCION_EVENTOS_WOMPI = 'eventos_wompi';

const YA_EXISTE = 6; // codigo gRPC ALREADY_EXISTS que devuelve Firestore en create()

/** Timestamps de Firestore -> Date (primer nivel y objetos anidados simples). */
function aJs(valor) {
  if (valor instanceof Timestamp) return valor.toDate();
  if (Array.isArray(valor)) return valor.map(aJs);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, aJs(v)]));
  }
  return valor;
}

const aPago = (snap) => (snap.exists ? aJs(snap.data()) : null);

/** @param {import('firebase-admin/firestore').Firestore} db */
export function crearRepoPagosFirestore(db) {
  const pagos = () => db.collection(COLECCION_PAGOS);
  const eventosDe = (referencia) => pagos().doc(referencia).collection(SUBCOLECCION_EVENTOS);

  return {
    almacen: 'firestore',

    async crear(pago, evento) {
      const lote = db.batch();
      lote.create(pagos().doc(pago.referencia), pago);
      if (evento) lote.create(eventosDe(pago.referencia).doc(), { ...evento, fecha: evento.fecha ?? new Date() });
      await lote.commit();
      return pago;
    },

    async obtener(referencia) {
      return aPago(await pagos().doc(referencia).get());
    },

    async buscarPorIdWompi(idTransaccion) {
      const snap = await pagos().where('idsTransaccionWompi', 'array-contains', idTransaccion).limit(1).get();
      return snap.empty ? null : aPago(snap.docs[0]);
    },

    async transicion(referencia, fn) {
      const ref = pagos().doc(referencia);
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref);
        if (!snap.exists) return null;
        const actual = aPago(snap);
        const resultado = fn(structuredClone(actual));
        const ahora = new Date();
        if (resultado?.cambios) t.update(ref, { ...resultado.cambios, actualizadoEn: ahora });
        if (resultado?.evento) {
          t.create(ref.collection(SUBCOLECCION_EVENTOS).doc(), { ...resultado.evento, fecha: resultado.evento.fecha ?? ahora });
        }
        const despues = resultado?.cambios ? { ...actual, ...resultado.cambios, actualizadoEn: ahora } : actual;
        return { antes: actual, despues };
      });
    },

    async agregarEvento(referencia, evento) {
      await eventosDe(referencia).add({ ...evento, fecha: evento.fecha ?? new Date() });
    },

    async listarEventos(referencia) {
      const snap = await eventosDe(referencia).orderBy('fecha', 'asc').get();
      return snap.docs.map((d) => aJs(d.data()));
    },

    // Indice: idUsuario ASC + creadoEn DESC
    async listarPorUsuario(idUsuario, limite = 20) {
      const snap = await pagos().where('idUsuario', '==', idUsuario).orderBy('creadoEn', 'desc').limit(limite).get();
      return snap.docs.map(aPago);
    },

    // Indice: estado ASC + creadoEn ASC
    async listarPendientesAntesDe(fecha, limite = 50) {
      const snap = await pagos()
        .where('estado', '==', 'PENDIENTE')
        .where('creadoEn', '<=', fecha)
        .orderBy('creadoEn', 'asc')
        .limit(limite)
        .get();
      return snap.docs.map(aPago);
    },

    // Indice: estado ASC + acreditado ASC
    async listarAprobadosSinAcreditar(limite = 50) {
      const snap = await pagos().where('estado', '==', 'APROBADO').where('acreditado', '==', false).limit(limite).get();
      return snap.docs.map(aPago);
    },

    async listarLibroPendiente(limite = 50) {
      const snap = await pagos().where('libroPendiente', '==', true).limit(limite).get();
      return snap.docs.map(aPago);
    },

    async reservarEventoWompi(id, datos) {
      const ref = db.collection(COLECCION_EVENTOS_WOMPI).doc(id);
      try {
        await ref.create({ ...datos, procesado: false, recibidoEn: new Date() });
        return { procesado: false };
      } catch (error) {
        if (error?.code !== YA_EXISTE) throw error;
        const snap = await ref.get();
        return { procesado: snap.get('procesado') === true };
      }
    },

    async marcarEventoWompiProcesado(id, resultado) {
      await db
        .collection(COLECCION_EVENTOS_WOMPI)
        .doc(id)
        .set({ ...resultado, procesado: true, procesadoEn: new Date() }, { merge: true });
    },

    async comprobar() {
      await pagos().limit(1).get();
    },
  };
}
