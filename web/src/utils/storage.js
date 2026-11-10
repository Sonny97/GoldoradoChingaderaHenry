/**
 * Acceso blindado a localStorage.
 *
 * localStorage LANZA en modo privado de Safari, con la cuota llena, o si el
 * usuario deshabilito el almacenamiento del sitio. Una excepcion aqui ocurre
 * durante el bootstrap de AuthProvider y deja la app en pantalla blanca sin
 * ninguna forma de recuperarse. Por eso ningun modulo toca window.localStorage
 * directamente: todo pasa por aqui.
 */

function getStore() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Lee y parsea JSON. Devuelve `fallback` ante cualquier fallo, nunca lanza. */
export function readJson(key, fallback = null) {
  const store = getStore();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch {
    // Valor corrupto: lo tratamos como ausente en vez de propagar el error.
    return fallback;
  }
}

/** Serializa y escribe. Devuelve true/false en vez de lanzar. */
export function writeJson(key, value) {
  const store = getStore();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  const store = getStore();
  if (!store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
