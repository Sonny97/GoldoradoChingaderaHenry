/**
 * Ayudantes de prueba compartidos (sin efectos al importar: node --test
 * tambien ejecuta este archivo y no debe encontrar nada que correr).
 */

import assert from 'node:assert/strict';

/** Logger que no imprime pero recuerda lo que se dijo, para contar avisos. */
export function logEnMemoria() {
  const lineas = { info: [], aviso: [], error: [], debug: [] };
  return {
    lineas,
    info: (m) => lineas.info.push(m),
    aviso: (m) => lineas.aviso.push(m),
    error: (m) => lineas.error.push(m),
    debug: (m) => lineas.debug.push(m),
  };
}

/** Error como los que entrega crearClienteGrpc (code + details). */
export function errorGrpc(code, details = 'falla simulada') {
  return Object.assign(new Error(`${code} ${details}`), { code, details });
}

/** La promesa debe fallar con ErrorNegocio de ese codigo gRPC y ese mensaje exacto. */
export async function rechazaCon(promesa, codigo, mensaje) {
  await assert.rejects(promesa, (error) => {
    assert.equal(error.name, 'ErrorNegocio', `se esperaba ErrorNegocio y llego: ${error.stack}`);
    assert.equal(error.codigo, codigo);
    assert.equal(error.message, mensaje);
    return true;
  });
}
