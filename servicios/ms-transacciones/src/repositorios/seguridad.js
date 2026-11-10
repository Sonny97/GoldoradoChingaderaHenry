// =============================================================================
//  Repositorio de seguridad: `logs_sesion` y `eventos_seguridad`.
//
//  Solo inserta y lee: un log de auditoria no se edita. Lo viejo de
//  logs_sesion lo borra Mongo con el indice TTL, no este codigo.
// =============================================================================

import { aDocumentoEvento, aDocumentoIntento } from '../utils/mapeo.js';

/**
 * @param {object} o
 * @param {() => import('mongodb').Collection} o.logsSesion
 * @param {() => import('mongodb').Collection} o.eventos
 */
export function crearRepositorioSeguridad({ logsSesion, eventos }) {
  return {
    async insertarIntento(datos) {
      await logsSesion().insertOne(aDocumentoIntento(datos));
    },

    /** Deteccion de fuerza bruta; la resuelve IX_LogsSesion_Email_Fecha. */
    contarFallidos({ emailIntento, desde }) {
      return logsSesion().countDocuments({ emailIntento, exitoso: false, fecha: { $gte: desde } });
    },

    async insertarEvento(datos) {
      await eventos().insertOne(aDocumentoEvento(datos));
    },

    listarEventos({ idUsuario, tipo, limite }) {
      const filtro = {};
      if (idUsuario) filtro.idUsuario = idUsuario;
      if (tipo) filtro.tipo = tipo;
      return eventos().find(filtro).sort({ fecha: -1, _id: -1 }).limit(limite).toArray();
    },
  };
}
