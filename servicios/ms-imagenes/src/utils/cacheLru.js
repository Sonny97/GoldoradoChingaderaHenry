/**
 * Cache LRU de bytes, con tope en BYTES (no en cantidad de entradas).
 *
 * Cada descarga de Drive (files.get alt=media) cuesta 200 unidades de cuota,
 * 40 veces un files.get de metadatos. Los 16 escudos de la home se piden en
 * cada carga: con ~20 MB en memoria se sirven casi siempre sin tocar Drive.
 * Map conserva el orden de insercion: el primero es el menos usado.
 */

export function crearCacheLru({ maxBytes = 20 * 1024 * 1024 } = {}) {
  const entradas = new Map();
  let usados = 0;

  function quitar(clave) {
    const actual = entradas.get(clave);
    if (!actual) return;
    entradas.delete(clave);
    usados -= actual.length;
  }

  return {
    get(clave) {
      const valor = entradas.get(clave);
      if (!valor) return undefined;
      entradas.delete(clave); // al final = el mas reciente
      entradas.set(clave, valor);
      return valor;
    },
    set(clave, buffer) {
      quitar(clave);
      if (buffer.length > maxBytes) return false; // nunca vaciar todo por una sola imagen
      entradas.set(clave, buffer);
      usados += buffer.length;
      for (const [vieja] of entradas) {
        if (usados <= maxBytes) break;
        quitar(vieja);
      }
      return true;
    },
    delete: quitar,
    clear() {
      entradas.clear();
      usados = 0;
    },
    get bytes() {
      return usados;
    },
    get size() {
      return entradas.size;
    },
  };
}
