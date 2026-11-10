/**
 * Frenos de fuerza bruta (express-rate-limit), iguales a los del monolito.
 *
 * Sin esto, la bitacora de intentos de sesion de MongoDB no es una defensa: es
 * el registro detallado de un ataque que nadie detuvo. En desarrollo el limite
 * es alto para no bloquearse uno mismo mientras prueba.
 *
 * Se crean con una fabrica (y no como constantes del modulo) para que cada app
 * tenga su propio contador: las pruebas construyen varias apps en el mismo
 * proceso y no deben compartir cupo.
 */

import rateLimit from 'express-rate-limit';

const QUINCE_MINUTOS = 15 * 60 * 1000;

const sobre = (message) => ({ success: false, data: null, message });

export function crearLimites({ esDesarrollo }) {
  const limiteAcceso = rateLimit({
    windowMs: QUINCE_MINUTOS,
    limit: esDesarrollo ? 100 : 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: sobre('Demasiados intentos de acceso. Espera unos minutos.'),
  });

  // Crear un pago llama a Wompi por internet: 20 en 15 minutos sobra para una
  // persona y frena a un script que quiera llenar Firestore de pagos basura.
  const limitePagos = rateLimit({
    windowMs: QUINCE_MINUTOS,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: sobre('Demasiados intentos de pago. Espera unos minutos.'),
  });

  return { limiteAcceso, limitePagos };
}
