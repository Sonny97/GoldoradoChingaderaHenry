/**
 * Servicio de autenticacion.
 *
 * Contrato: toda funcion es async y resuelve a { success, data, message }.
 * Nunca lanza por errores de negocio.
 *
 * ESTE ARCHIVO CAMBIO DE CUERPO, NO DE FIRMA. Antes leia y escribia un objeto
 * en localStorage; ahora llama al backend, que consulta SQL Server. Las
 * funciones se llaman igual, reciben lo mismo y devuelven lo mismo, y por eso
 * AuthProvider, LoginForm, RegisterForm y RecoverPage no se tocaron.
 *
 * La contraseña ya no se guarda ni se compara aqui: viaja al backend, que la
 * verifica con bcrypt contra el hash de la tabla Usuario. El navegador nunca ve
 * un hash y la base nunca ve una contraseña en claro.
 */

import { http, guardarToken, borrarToken, leerToken, BASE } from './http';
import { fail } from '../utils/apiResult';

/* ------------------------------------------------------------------ auth */

export async function login({ username, password }) {
  const res = await http.post('/auth/login', { username, password });

  // El token se guarda AQUI y no en el componente: es la unica forma de que
  // exista un solo lugar donde empieza una sesion.
  if (res.success && res.data?.token) guardarToken(res.data.token);

  return res;
}

export async function register(values) {
  const res = await http.post('/auth/register', values);
  if (res.success && res.data?.token) guardarToken(res.data.token);
  return res;
}

export async function logout() {
  // Se avisa al backend, pero el token local se borra pase lo que pase: si la
  // red falla, el usuario igual espera haber salido de su cuenta.
  const res = await http.post('/auth/logout', {}, { auth: true });
  borrarToken();
  return res.success ? res : { success: true, data: null, message: 'Sesión cerrada' };
}

/**
 * Rehidrata la sesion en el arranque.
 *
 * Sin token no se llama al servidor: seria una peticion que ya se sabe que va a
 * dar 401, y retrasaria el primer render de toda la aplicacion.
 *
 * El comentario original decia que el dia que esto fuera un GET /me de verdad
 * el loader de los guards ya estaria implementado. Ese dia llego: ahora esto SI
 * es una peticion de red, y ProtectedRoute sigue funcionando igual.
 */
export async function getCurrentUser() {
  if (!leerToken()) return fail('No hay sesión activa');

  const res = await http.get('/auth/me', { auth: true });

  // El token existe pero el backend lo rechaza (vencido, o el usuario ya no
  // esta). Se limpia para no reintentar en cada arranque.
  if (!res.success) borrarToken();

  return res;
}

/**
 * Relee /auth/me SIN borrar el token si la peticion falla.
 *
 * getCurrentUser borra el token ante cualquier fallo porque en el arranque no
 * hay nada que perder. A mitad de sesion es distinto: un microcorte de red
 * despues de apostar no puede sacar al usuario de su cuenta. Aqui solo se
 * pierde la sesion si el backend responde 401, y eso ya lo limpia http.js.
 */
export async function readCurrentUser() {
  if (!leerToken()) return fail('No hay sesión activa');
  return http.get('/auth/me', { auth: true });
}

/** true si hay un token guardado. No dice si sigue vigente: eso lo sabe el backend. */
export function hasSession() {
  return Boolean(leerToken());
}

/**
 * `userId` se conserva en la firma porque AuthProvider lo pasa, pero el backend
 * lo ignora: saca el usuario del token. Si lo tomara del cuerpo, cualquiera
 * podria editar el perfil de otro mandando un id distinto.
 */
export async function updateProfile(userId, patch) {
  return http.patch('/auth/perfil', patch, { auth: true });
}

/* ------------------------------------------------------- recuperacion */

export async function lookupAccount(username) {
  return http.post('/auth/recuperar/buscar', { username });
}

export async function requestRecoveryCode({ username, method }) {
  return http.post('/auth/recuperar/solicitar', { username, method });
}

/**
 * El backend responde con data.tokenDead cuando la solicitud ya no sirve
 * (vencida o sin intentos). RecoverPage lee esa bandera para devolver al
 * usuario al paso de elegir metodo, en vez de dejarlo tecleando en un formulario
 * que ya rechaza todo.
 */
export async function verifyRecoveryCode({ token, code }) {
  return http.post('/auth/recuperar/verificar', { token, code });
}

export async function resetPassword({ resetToken, password }) {
  return http.post('/auth/recuperar/restablecer', { resetToken, password });
}

/* --------------------------------------------- cuentas externas (OAuth) */

/**
 * Lista Google / Microsoft con su bandera `enabled`. Un proveedor sin llaves en
 * el BFF llega con enabled=false y el boton se pinta deshabilitado en vez de
 * desaparecer: asi el usuario sabe que la opcion existe.
 */
export async function getProviders() {
  return http.get('/auth/proveedores');
}

/**
 * URL a la que el navegador debe IR (no un fetch): el BFF responde 302 hacia
 * Google o Microsoft y guarda state/nonce/verifier en una cookie firmada. Si
 * se pidiera con fetch, la redireccion cruzaria de origen y se perderia.
 *
 * `destino` es siempre una ruta interna. Si llegara una URL absoluta, se
 * descarta: aceptar cualquier destino convertiria el login en un redirector
 * abierto.
 */
export function oauthStartUrl(provider, destino = '/inicio') {
  const seguro = typeof destino === 'string' && destino.startsWith('/') && !destino.startsWith('//')
    ? destino
    : '/inicio';
  const parametros = new URLSearchParams({ destino: seguro });
  return `${BASE}/auth/oauth/${encodeURIComponent(String(provider).toLowerCase())}?${parametros}`;
}

/** Ficha que le falta a quien entro con Google o Microsoft. */
export async function completeProfile(values) {
  return http.post('/auth/completar-perfil', values, { auth: true });
}

/**
 * Sube la foto de perfil. El campo se llama `imagen` porque asi lo espera el
 * BFF (multer). http.js detecta el FormData y no le pone Content-Type.
 */
export async function uploadAvatar(file) {
  const formulario = new FormData();
  formulario.append('imagen', file);
  return http.post('/auth/avatar', formulario, { auth: true });
}

export async function removeAvatar() {
  return http.delete('/auth/avatar', { auth: true });
}

/**
 * Revoca TODAS las sesiones del usuario, incluida la de esta pestaña. El token
 * local se borra aunque la red falle, igual que en logout().
 */
export async function logoutAll() {
  const res = await http.post('/auth/logout-todos', {}, { auth: true });
  if (res.success) borrarToken();
  return res;
}
