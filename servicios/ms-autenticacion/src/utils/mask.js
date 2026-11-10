/**
 * Enmascarado de destinos para la recuperacion de clave (port de
 * server/utils/mask.js del monolito, mismo formato: ****@hotmail.com / ***** 567).
 *
 * Se enmascara EN EL SERVIDOR. Si viajaran el correo y el telefono completos
 * para que React los tapara con asteriscos, el dato estaria igual a la vista en
 * la pestaña Network: el asterisco seria decoracion, no privacidad. Y como
 * BuscarCuenta no exige sesion, el dato completo seria un regalo para quien
 * pruebe documentos ajenos.
 */

/** juan.perez@hotmail.com -> ****@hotmail.com */
export function enmascararEmail(email) {
  const valor = String(email || '').trim();
  const arroba = valor.indexOf('@');
  if (arroba < 1) return '****';
  return `****${valor.slice(arroba)}`;
}

/** 3001234567 -> ***** 567 (deja visibles los 3 ultimos digitos) */
export function enmascararTelefono(telefono) {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.length < 3) return '*****';
  return `***** ${digitos.slice(-3)}`;
}
