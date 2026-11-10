/**
 * Re-empaqueta cualquier flujo de bytes en trozos de tamaño FIJO.
 *
 * Drive entrega la descarga en pedazos del tamaño que le parezca (a veces
 * 16 KB, a veces 1 MB) y fs.createReadStream en los suyos. El contrato de
 * ObtenerImagen promete trozos de 64 KB (el ultimo puede ser menor), asi el
 * BFF sabe cuanta memoria usa cada mensaje.
 */

export const TAMANO_TROZO = 64 * 1024;

/**
 * @param {AsyncIterable<Buffer|Uint8Array|string>} fuente
 * @param {number} [tamano]
 * @returns {AsyncGenerator<Buffer>}
 */
export async function* enTrozos(fuente, tamano = TAMANO_TROZO) {
  let pendientes = [];
  let acumulado = 0;

  for await (const pedazo of fuente) {
    const buf = Buffer.isBuffer(pedazo) ? pedazo : Buffer.from(pedazo);
    if (buf.length === 0) continue;
    pendientes.push(buf);
    acumulado += buf.length;

    if (acumulado >= tamano) {
      let junto = pendientes.length === 1 ? pendientes[0] : Buffer.concat(pendientes, acumulado);
      while (junto.length >= tamano) {
        yield junto.subarray(0, tamano);
        junto = junto.subarray(tamano);
      }
      pendientes = junto.length > 0 ? [junto] : [];
      acumulado = junto.length;
    }
  }
  if (acumulado > 0) yield pendientes.length === 1 ? pendientes[0] : Buffer.concat(pendientes, acumulado);
}

/** Un Buffer completo como fuente iterable (para la cache y el almacen local). */
export async function* desdeBuffer(buffer) {
  yield buffer;
}
