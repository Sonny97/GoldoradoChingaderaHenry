/**
 * Predicados puros + esquemas de validacion por formulario.
 *
 * Son funciones puras a proposito: PasswordStrength necesita scorePassword()
 * sin ningun formulario de por medio, y el <input type="date"> necesita
 * maxBirthDateIso() para su atributo `max`. Si esta logica viviera dentro de
 * useForm, ninguno de los dos podria alcanzarla.
 */

import { MIN_AGE, DOCUMENT_TYPES } from './constants';

export const REQUIRED = 'Este campo es obligatorio';

/* ---------------------------------------------------------------- predicados */

export const isEmpty = (v) => v === null || v === undefined || String(v).trim() === '';
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(v).trim());
export const isDigits = (v) => /^\d+$/.test(String(v).trim());
// À-ſ cubre todas las vocales acentuadas, la enie y la dieresis sin
// depender de que el archivo se lea como UTF-8.
export const isName = (v) => /^[A-Za-zÀ-ſ' -]{2,40}$/.test(String(v).trim());
export const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

/** Sanitizador para teléfono y documento: deja solo digitos. */
export const digitsOnly = (v) => String(v).replace(/\D/g, '');

/* --------------------------------------------------------------- fechas */

/**
 * Parseo de fecha SEGURO EN ZONA HORARIA.
 *
 * `new Date('1998-04-12')` se interpreta como medianoche UTC, que en Bogota
 * (UTC-5) es el 11 de abril. Ese off-by-one rechaza silenciosamente a quien
 * cumple 18 años justo hoy. Construimos la fecha con partes locales.
 */
export function parseIsoDateLocal(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

export function getAge(iso) {
  const dob = parseIsoDateLocal(iso);
  if (Number.isNaN(dob.getTime())) return -1;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export const isAdult = (iso) => getAge(iso) >= MIN_AGE;

export const isFutureDate = (iso) => {
  const d = parseIsoDateLocal(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() > Date.now();
};

/** Hoy menos 18 años en formato YYYY-MM-DD, para el atributo `max` del input. */
export function maxBirthDateIso() {
  const now = new Date();
  const d = new Date(now.getFullYear() - MIN_AGE, now.getMonth(), now.getDate());
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/* ------------------------------------------------------------- contraseña */

export const PASSWORD_LEVELS = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Excelente'];

/**
 * Puntaje 0..4 que alimenta directamente las 4 rayas del medidor del boceto.
 * Una clave muy corta nunca puede pasar de 1, aunque cumpla otras reglas.
 */
export function scorePassword(pwd = '') {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[A-Z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  if (pwd.length < 6) return Math.min(score, 1);
  return Math.min(4, score);
}

export const isStrongPassword = (pwd) => scorePassword(pwd) >= 3;

/* ----------------------------------------------------------- esquemas */

export function validateLogin(values) {
  const errors = {};
  if (isEmpty(values.username)) errors.username = 'Ingresa tu correo o documento';
  if (isEmpty(values.password)) errors.password = 'Ingresa tu contraseña';
  return errors;
}

export function validateRegister(values) {
  const errors = {};

  if (isEmpty(values.name)) errors.name = 'Ingresa tu nombre';
  else if (!isName(values.name)) errors.name = 'El nombre solo admite letras';

  if (isEmpty(values.lastname)) errors.lastname = 'Ingresa tu apellido';
  else if (!isName(values.lastname)) errors.lastname = 'El apellido solo admite letras';

  if (isEmpty(values.email)) errors.email = 'Ingresa tu correo';
  else if (!isEmail(values.email)) errors.email = 'Correo electrónico inválido';

  if (isEmpty(values.password)) errors.password = 'Ingresa una contraseña';
  else if (values.password.length < 8) errors.password = 'Mínimo 8 caracteres';
  else if (!isStrongPassword(values.password)) {
    errors.password = 'Debe incluir una mayúscula, un número y un símbolo';
  }

  const validTypes = DOCUMENT_TYPES.map((t) => t.value);
  if (isEmpty(values.documentType) || !validTypes.includes(values.documentType)) {
    errors.documentType = 'Selecciona el tipo de documento';
  }

  if (isEmpty(values.documentNumber)) errors.documentNumber = 'Ingresa tu documento';
  else if (!isDigits(values.documentNumber)) errors.documentNumber = 'El documento solo admite números';
  else if (values.documentNumber.length < 6 || values.documentNumber.length > 15) {
    errors.documentNumber = 'Documento inválido';
  }

  if (isEmpty(values.phone)) errors.phone = 'Ingresa tu teléfono';
  else if (!isDigits(values.phone)) errors.phone = 'El teléfono solo admite números';
  else if (values.phone.length < 7 || values.phone.length > 15) errors.phone = 'Teléfono inválido';

  if (isEmpty(values.birthDate)) errors.birthDate = 'Ingresa tu fecha de nacimiento';
  else if (!isIsoDate(values.birthDate)) errors.birthDate = 'Fecha inválida';
  else if (isFutureDate(values.birthDate)) errors.birthDate = 'La fecha no puede ser futura';
  else if (!isAdult(values.birthDate)) errors.birthDate = `Debes ser mayor de ${MIN_AGE} años`;

  if (!values.terms) errors.terms = 'Debes aceptar los términos para continuar';

  return errors;
}

export function validateIdentify(values) {
  const errors = {};
  if (isEmpty(values.username)) errors.username = 'Ingresa tu correo o documento';
  return errors;
}

export function validateNewPassword(values) {
  const errors = {};

  if (isEmpty(values.password)) errors.password = 'Ingresa una contraseña';
  else if (values.password.length < 8) errors.password = 'Mínimo 8 caracteres';
  else if (!isStrongPassword(values.password)) {
    errors.password = 'Debe incluir una mayúscula, un número y un símbolo';
  }

  if (isEmpty(values.confirm)) errors.confirm = 'Confirma tu contraseña';
  else if (values.confirm !== values.password) errors.confirm = 'Las contraseñas no coinciden';

  return errors;
}

/**
 * Ficha de quien entro con Google o Microsoft. Son los mismos campos y las
 * mismas reglas de validateRegister menos correo y contraseña (el correo lo da
 * el proveedor y la cuenta no tiene clave). Se reutiliza validateRegister en
 * vez de copiar las reglas: si mañana cambia la edad minima, cambia en los dos.
 */
export function validateCompleteProfile(values) {
  const { email: _email, password: _password, ...errors } = validateRegister({
    ...values,
    email: 'ficha@goldorado.co',
    password: 'Aa1!aaaa',
  });
  return errors;
}

/** Edicion en /perfil: solo nombre, apellido y telefono. */
export function validateProfileEdit(values) {
  const errors = {};

  if (isEmpty(values.name)) errors.name = 'Ingresa tu nombre';
  else if (!isName(values.name)) errors.name = 'El nombre solo admite letras';

  if (isEmpty(values.lastname)) errors.lastname = 'Ingresa tu apellido';
  else if (!isName(values.lastname)) errors.lastname = 'El apellido solo admite letras';

  if (isEmpty(values.phone)) errors.phone = 'Ingresa tu teléfono';
  else if (!isDigits(values.phone)) errors.phone = 'El teléfono solo admite números';
  else if (values.phone.length < 7 || values.phone.length > 15) errors.phone = 'Teléfono inválido';

  return errors;
}
