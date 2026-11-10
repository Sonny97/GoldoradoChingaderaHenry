/**
 * Cliente HTTP de la aplicacion.
 *
 * ES EL UNICO MODULO QUE HABLA CON EL BACKEND. Ningun componente, hook ni
 * servicio llama a fetch por su cuenta.
 *
 * Devuelve SIEMPRE el sobre { success, data, message }, que es exactamente el
 * mismo contrato que tenian los servicios cuando los datos salian de
 * localStorage. Por eso al cambiar el mock por SQL Server, y despues el
 * monolito por el BFF de microservicios, no hubo que tocar AuthProvider, ni los
 * formularios, ni una sola pantalla.
 *
 * NUNCA LANZA. Un servidor apagado, una respuesta que no es JSON o un timeout
 * salen como fail() con un mensaje legible. Si lanzara, cada caller necesitaria
 * su propio try/catch y una excepcion no atrapada durante el arranque de
 * AuthProvider dejaria la aplicacion en pantalla blanca.
 */

import { ok, fail } from '../utils/apiResult';
import { readJson, writeJson, removeKey } from '../utils/storage';
import { STORAGE_KEYS } from '../utils/constants';

/**
 * Ruta relativa a proposito.
 *
 * En desarrollo, Vite hace de proxy de /api hacia el BFF en
 * http://localhost:3000 (ver vite.config.js), asi que el navegador ve un mismo
 * origen y CORS no interviene. En produccion, el frontend construido y el BFF
 * se sirven bajo el mismo dominio. Poner aqui la URL absoluta obligaria a
 * recompilar para cambiar de entorno.
 */
export const BASE = '/api';

/** Un backend que no responde en 15 s esta caido, no lento. */
const TIMEOUT_MS = 15000;

/**
 * Subir una foto de 5 MB por una red movil si puede tardar mas de 15 s. Las
 * peticiones con archivo tienen su propio plazo para no cortar una subida
 * legitima a medio camino.
 */
const TIMEOUT_ARCHIVOS_MS = 60000;

/* ------------------------------------------------------------------ token */

export function leerToken() {
  const sesion = readJson(STORAGE_KEYS.SESSION, null);
  return sesion?.token ?? null;
}

export function guardarToken(token) {
  writeJson(STORAGE_KEYS.SESSION, { token, issuedAt: new Date().toISOString() });
}

export function borrarToken() {
  removeKey(STORAGE_KEYS.SESSION);
}

/* ----------------------------------------------------------------- fetch */

/**
 * Petición genérica.
 *
 * @param {string} ruta      camino bajo /api, por ejemplo '/auth/login'
 * @param {object} opciones  { method, body, auth, query, timeoutMs }
 *
 * `body` puede ser un objeto (viaja como JSON) o un FormData (viaja como
 * multipart, por ejemplo la foto de perfil).
 */
async function peticion(ruta, { method = 'GET', body, auth = false, query, timeoutMs } = {}) {
  // Un FormData NO lleva Content-Type puesto a mano ni pasa por
  // JSON.stringify: el navegador escribe 'multipart/form-data; boundary=...' y
  // ese boundary solo lo conoce el. Si se fijara la cabecera aqui, el servidor
  // no podria separar las partes del cuerpo.
  const esFormulario = typeof FormData !== 'undefined' && body instanceof FormData;

  // AbortController es lo que convierte un servidor colgado en un mensaje de
  // error. Sin el, fetch espera el timeout del sistema operativo (minutos) y el
  // usuario ve un spinner eterno.
  const controlador = new AbortController();
  const plazo = timeoutMs ?? (esFormulario ? TIMEOUT_ARCHIVOS_MS : TIMEOUT_MS);
  const temporizador = setTimeout(() => controlador.abort(), plazo);

  try {
    const cabeceras = {};
    if (body !== undefined && !esFormulario) cabeceras['Content-Type'] = 'application/json';

    if (auth) {
      const token = leerToken();
      if (token) cabeceras.Authorization = `Bearer ${token}`;
    }

    // URLSearchParams se encarga de escapar los valores. Concatenar a mano
    // rompe con un acento o un '&' dentro de un filtro.
    let url = `${BASE}${ruta}`;
    if (query) {
      const parametros = new URLSearchParams();
      for (const [clave, valor] of Object.entries(query)) {
        if (valor !== undefined && valor !== null && valor !== '') {
          parametros.append(clave, String(valor));
        }
      }
      const cadena = parametros.toString();
      if (cadena) url += `?${cadena}`;
    }

    let cuerpo;
    if (body !== undefined) cuerpo = esFormulario ? body : JSON.stringify(body);

    const respuesta = await fetch(url, {
      method,
      headers: cabeceras,
      body: cuerpo,
      signal: controlador.signal,
    });

    // Si el token vencio (o se cerro la sesion en todos los dispositivos), se
    // limpia aqui mismo. Dejarlo guardado haria que cada peticion siguiente
    // fallara con 401 sin que la aplicacion se entere de que la sesion ya no
    // existe.
    if (respuesta.status === 401 && auth) borrarToken();

    const tipo = respuesta.headers.get('content-type') ?? '';

    if (!tipo.includes('application/json')) {
      // 502/504 sin JSON son los que devuelve el proxy de Vite cuando el BFF no
      // esta escuchando: el mensaje dice lo que de verdad pasa.
      if (respuesta.status === 502 || respuesta.status === 504) {
        return fail('No pudimos conectar con el servidor. ¿Está encendido el backend?');
      }
      // Pasa cuando el proxy no esta levantado y Vite devuelve el index.html:
      // sin esta guarda, el JSON.parse falla con un error incomprensible.
      return fail(
        respuesta.status === 404
          ? 'El servidor no encontró ese recurso'
          : 'El servidor respondió en un formato inesperado'
      );
    }

    const sobre = await respuesta.json();

    // El BFF ya devuelve { success, data, message }: se reenvia tal cual.
    if (sobre && typeof sobre.success === 'boolean') return sobre;

    // Red de seguridad por si alguna capa intermedia responde otra cosa.
    return respuesta.ok
      ? ok(sobre)
      : fail(sobre?.message || 'Ocurrió un error inesperado');
  } catch (error) {
    if (error.name === 'AbortError') {
      return fail('El servidor tardó demasiado en responder');
    }
    // TypeError es lo que lanza fetch cuando no hay nadie al otro lado.
    return fail('No pudimos conectar con el servidor. ¿Está encendido el backend?');
  } finally {
    clearTimeout(temporizador);
  }
}

export const http = {
  get: (ruta, opciones) => peticion(ruta, { ...opciones, method: 'GET' }),
  post: (ruta, body, opciones) => peticion(ruta, { ...opciones, method: 'POST', body }),
  patch: (ruta, body, opciones) => peticion(ruta, { ...opciones, method: 'PATCH', body }),
  delete: (ruta, opciones) => peticion(ruta, { ...opciones, method: 'DELETE' }),
};
