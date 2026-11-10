// =============================================================================
//  Repositorio de `transacciones`: TODA la consulta a esa coleccion.
//
//  Recibe `coleccion` como funcion (() => Collection) para que las pruebas
//  le pasen una coleccion falsa en memoria y para no tocar la base al crear
//  el objeto. Los filtros son objetos con valores ya tipados: nunca se arma
//  un filtro a partir de texto del usuario.
// =============================================================================

import { aDocumentoTransaccion, aEntradaHistorial } from '../utils/mapeo.js';

const CLAVE_DUPLICADA = 11000;

export function crearRepositorioTransacciones(coleccion) {
  return {
    /**
     * Inserta la transaccion SOLO si su codigo no existe (upsert con
     * $setOnInsert: si ya existe no se toca nada). returnDocument 'before'
     * devuelve null cuando la acaba de crear y el documento previo cuando ya
     * existia: asi se sabe que paso en UNA ida a la base.
     */
    async insertarSiNoExiste(datos) {
      const documento = aDocumentoTransaccion(datos);
      try {
        const previo = await coleccion().findOneAndUpdate(
          { codigo: datos.codigo },
          { $setOnInsert: documento },
          { upsert: true, returnDocument: 'before' }
        );
        return previo ? { documento: previo, creada: false } : { documento, creada: true };
      } catch (error) {
        if (error?.code !== CLAVE_DUPLICADA) throw error;
        // Dos registros simultaneos del mismo codigo: el otro gano la carrera
        // y el indice UQ_Transacciones_Codigo freno el duplicado.
        return { documento: await coleccion().findOne({ codigo: datos.codigo }), creada: false };
      }
    },

    buscarPorCodigo(codigo) {
      return coleccion().findOne({ codigo });
    },

    /**
     * Cambio de estado (y/o datos que faltaban) + su entrada en el historial,
     * en una sola operacion atomica sobre un documento. El filtro exige el
     * estado que se leyo: si alguien lo cambio en el medio devuelve null y el
     * servicio vuelve a decidir (asi `estadoAnterior` nunca miente).
     */
    aplicarCambio({ codigo, estadoEsperado, estadoNuevo, completar = {}, entrada, fecha }) {
      const cambios = { $set: { ...completar, estado: estadoNuevo, actualizadoEn: fecha } };
      if (entrada) cambios.$push = { historial: aEntradaHistorial(entrada) };
      return coleccion().findOneAndUpdate({ codigo, estado: estadoEsperado }, cambios, {
        returnDocument: 'after',
      });
    },

    /** Mas recientes primero; lo resuelve IX_Transacciones_Usuario_Fecha. */
    listarPorUsuario({ idUsuario, tipo, limite }) {
      const filtro = { idUsuario }; // number contra long: Mongo compara numeros por valor
      if (tipo) filtro.tipo = tipo;
      return coleccion().find(filtro).sort({ creadoEn: -1, _id: -1 }).limit(limite).toArray();
    },
  };
}
