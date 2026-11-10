/**
 * Validacion de formularios EN EL SERVIDOR.
 *
 * Port de src/utils/validators.js del monolito, con los MISMOS mensajes y las
 * mismas reglas. En el monolito solo validaba el navegador; aqui se repite
 * porque el BFF no es el unico cliente posible de este servicio y porque saltarse
 * un formulario React es tan facil como abrir la consola. La garantia final
 * sigue siendo la base (CHECK y UNIQUE de 01_esquema.sql).
 *
 * Los errores salen como { campo: mensaje } con los nombres del .proto, y el
 * servicio lanza el primero con todos adjuntos en x-datos.
 */

export const MAYORIA_DE_EDAD = 18;

/**
 * La edad se calcula con el calendario de Colombia, no con la zona del
 * servidor: un contenedor en UTC ya va en "mañana" desde las 7 p. m. de Bogota,
 * y aceptaria un dia antes a quien todavia tiene 17.
 */
export const ZONA_NEGOCIO = 'America/Bogota';

/* ---------------------------------------------------------------- predicados */

export const estaVacio = (v) => v === null || v === undefined || String(v).trim() === '';
export const esEmail = (v) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v).trim());
export const esSoloDigitos = (v) => /^\d+$/.test(String(v).trim());
// À-ſ cubre vocales acentuadas, eñe y dieresis (el "À-ſ" del monolito).
export const esNombre = (v) => /^[A-Za-zÀ-ſ' -]{2,40}$/.test(String(v).trim());

/**
 * YYYY-MM-DD que ademas EXISTA en el calendario. El monolito solo miraba el
 * formato porque el <input type="date"> no deja escribir un 30 de febrero;
 * por gRPC si llega, y SQL Server lo rechazaria con un error de conversion.
 */
export function esFechaIso(v) {
  const texto = String(v ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  return (
    a >= 1900 &&
    fecha.getUTCFullYear() === a &&
    fecha.getUTCMonth() === m - 1 &&
    fecha.getUTCDate() === d
  );
}

/* -------------------------------------------------------------------- fechas */

/** Fecha de calendario de "hoy" en una zona, sin depender de la zona del proceso. */
export function hoyEnZona(ahoraMs = Date.now(), zona = ZONA_NEGOCIO) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ahoraMs));
  const valor = (tipo) => Number(partes.find((p) => p.type === tipo)?.value);
  const anio = valor('year');
  const mes = valor('month');
  const dia = valor('day');
  const pad = (n) => String(n).padStart(2, '0');
  return { anio, mes, dia, iso: `${anio}-${pad(mes)}-${pad(dia)}` };
}

/**
 * Edad cumplida con aritmetica de calendario pura.
 *
 * Nunca se hace `new Date('1998-04-12')`: eso es medianoche UTC, que en Bogota
 * es el dia anterior, y el off-by-one rechaza o acepta mal a quien cumple
 * años justo hoy (el mismo problema que el monolito resolvio en el navegador).
 */
export function edad(iso, ahoraMs = Date.now(), zona = ZONA_NEGOCIO) {
  if (!esFechaIso(iso)) return -1;
  const [a, m, d] = String(iso).split('-').map(Number);
  const hoy = hoyEnZona(ahoraMs, zona);
  let anios = hoy.anio - a;
  if (hoy.mes < m || (hoy.mes === m && hoy.dia < d)) anios -= 1;
  return anios;
}

export const esMayorDeEdad = (iso, ahoraMs, zona) => edad(iso, ahoraMs, zona) >= MAYORIA_DE_EDAD;

export const esFechaFutura = (iso, ahoraMs, zona) =>
  esFechaIso(iso) && String(iso) > hoyEnZona(ahoraMs, zona).iso;

/* ----------------------------------------------------------------- contraseña */

/**
 * Puntaje 0..4, port literal de scorePassword(): el mismo que pinta las 4
 * rayas del medidor. Una clave muy corta nunca pasa de 1 aunque cumpla otras
 * reglas.
 */
export function puntajePassword(pwd = '') {
  if (!pwd) return 0;
  let puntaje = 0;
  if (pwd.length >= 8) puntaje += 1;
  if (/[A-Z]/.test(pwd)) puntaje += 1;
  if (/\d/.test(pwd)) puntaje += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) puntaje += 1;
  if (pwd.length < 6) return Math.min(puntaje, 1);
  return Math.min(4, puntaje);
}

export const esPasswordFuerte = (pwd) => puntajePassword(pwd) >= 3;

/** Mensaje de error de una clave nueva, o null si sirve. */
export function errorPassword(password) {
  const valor = String(password ?? '');
  if (estaVacio(valor)) return 'Ingresa una contraseña';
  if (valor.length < 8) return 'Mínimo 8 caracteres';
  if (!esPasswordFuerte(valor)) return 'Debe incluir una mayúscula, un número y un símbolo';
  return null;
}

/* ------------------------------------------------------------------ esquemas */

function errorNombre(valor, vacio, invalido) {
  if (estaVacio(valor)) return vacio;
  if (!esNombre(valor)) return invalido;
  return null;
}

function errorDocumento(valor) {
  const texto = String(valor ?? '').trim();
  if (estaVacio(texto)) return 'Ingresa tu documento';
  if (!esSoloDigitos(texto)) return 'El documento solo admite números';
  if (texto.length < 6 || texto.length > 15) return 'Documento inválido';
  return null;
}

export function errorTelefono(valor) {
  const texto = String(valor ?? '').trim();
  if (estaVacio(texto)) return 'Ingresa tu teléfono';
  if (!esSoloDigitos(texto)) return 'El teléfono solo admite números';
  if (texto.length < 7 || texto.length > 15) return 'Teléfono inválido';
  return null;
}

function errorFechaNacimiento(valor, ahoraMs, zona) {
  if (estaVacio(valor)) return 'Ingresa tu fecha de nacimiento';
  if (!esFechaIso(valor)) return 'Fecha inválida';
  if (esFechaFutura(valor, ahoraMs, zona)) return 'La fecha no puede ser futura';
  if (!esMayorDeEdad(valor, ahoraMs, zona)) return `Debes ser mayor de ${MAYORIA_DE_EDAD} años`;
  return null;
}

/** Quita los campos sin error: { campo: mensaje } solo con los que fallaron. */
const soloErrores = (errores) =>
  Object.fromEntries(Object.entries(errores).filter(([, mensaje]) => mensaje));

/**
 * Ficha de cliente (Registrar y CompletarPerfil). `tiposValidos` viene de la
 * tabla Tipo_Documento: la lista no se repite en el codigo.
 */
export function validarFichaCliente(valores, { tiposValidos = [], ahoraMs = Date.now(), zona } = {}) {
  const tipo = String(valores.tipoDocumento ?? '').trim();
  return soloErrores({
    nombres: errorNombre(valores.nombres, 'Ingresa tu nombre', 'El nombre solo admite letras'),
    apellidos: errorNombre(valores.apellidos, 'Ingresa tu apellido', 'El apellido solo admite letras'),
    tipoDocumento: !tipo || !tiposValidos.includes(tipo) ? 'Selecciona el tipo de documento' : null,
    numeroDocumento: errorDocumento(valores.numeroDocumento),
    telefono: errorTelefono(valores.telefono),
    fechaNacimiento: errorFechaNacimiento(valores.fechaNacimiento, ahoraMs, zona),
  });
}

/** Registro completo: la ficha + correo y contraseña (orden de validateRegister). */
export function validarRegistro(valores, opciones = {}) {
  const ficha = validarFichaCliente(valores, opciones);
  let email = null;
  if (estaVacio(valores.email)) email = 'Ingresa tu correo';
  else if (!esEmail(valores.email)) email = 'Correo electrónico inválido';

  return soloErrores({
    nombres: ficha.nombres,
    apellidos: ficha.apellidos,
    email,
    password: errorPassword(valores.password),
    tipoDocumento: ficha.tipoDocumento,
    numeroDocumento: ficha.numeroDocumento,
    telefono: ficha.telefono,
    fechaNacimiento: ficha.fechaNacimiento,
  });
}

/**
 * Edicion del perfil: solo valida lo que llego (campos `optional` del .proto).
 * Un campo ausente no se toca; uno presente y vacio si es un error.
 */
export function validarCambiosPerfil({ nombres, apellidos, telefono }) {
  return soloErrores({
    nombres:
      nombres === undefined ? null : errorNombre(nombres, 'Ingresa tu nombre', 'El nombre solo admite letras'),
    apellidos:
      apellidos === undefined
        ? null
        : errorNombre(apellidos, 'Ingresa tu apellido', 'El apellido solo admite letras'),
    telefono: telefono === undefined ? null : errorTelefono(telefono),
  });
}
