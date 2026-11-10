/**
 * Catalogos de la aplicacion. Mismo contrato { success, data, message }.
 *
 * Existe para que los <select> se llenen desde las TABLAS de catalogo y no
 * desde una lista fija en el codigo. Una lista fija se desincroniza en cuanto
 * alguien agrega una fila a la tabla, y el error aparece tarde y mal: como una
 * violacion de llave foranea al guardar.
 */

import { http } from './http';

/** Tipos de documento, desde la tabla Tipo_Documento. */
export async function getDocumentTypes() {
  return http.get('/catalogos/tipos-documento');
}
