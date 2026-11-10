/**
 * Enmascarado de destinos para la pantalla de recuperacion.
 * Reproduce el formato del boceto: ****@hotmail.com  /  ***** 123
 */

/** juan.perez@hotmail.com -> ****@hotmail.com */
export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at < 1) return '****';
  return `****${value.slice(at)}`;
}

/** 3001234567 -> ***** 567 (deja visibles los 3 ultimos digitos) */
export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 3) return '*****';
  return `***** ${digits.slice(-3)}`;
}
