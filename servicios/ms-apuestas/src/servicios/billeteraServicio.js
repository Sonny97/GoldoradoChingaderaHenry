/**
 * Reglas de la billetera: crearla, consultarla y acreditar depositos.
 *
 * AcreditarDeposito la llama ms-pagos cuando Wompi aprueba un pago, y puede
 * llegar dos veces (webhook + conciliacion). La idempotencia la garantiza la
 * base (UNIQUE de movimiento_saldo.referencia); aqui se valida la entrada y se
 * traduce el resultado. No se escribe evento en la bandeja de salida: el ciclo
 * de vida del DEPOSITO en el libro de MongoDB es de ms-pagos.
 */

import { invalido, noEncontrado, yaExiste } from '@goldorado/comun';
import { exigirIdUsuario, exigirMontoEntero, textoOpcional } from '../utils/validacion.js';

// NUMERIC(18,2) admite hasta 16 digitos enteros; mas alla la base fallaria con
// un error generico. Ningun pago real se acerca.
const MONTO_MAXIMO_DEPOSITO = 9_999_999_999_999;

/** @param {{ repo: object, log?: object }} o */
export function crearServicioBilletera({ repo, log }) {
  async function asegurar(idUsuario) {
    return repo.asegurar(exigirIdUsuario(idUsuario));
  }

  async function obtener(idUsuario) {
    const billetera = await repo.obtener(exigirIdUsuario(idUsuario));
    if (!billetera) throw noEncontrado('La cuenta no tiene billetera');
    return billetera;
  }

  async function acreditarDeposito({ idUsuario, monto: montoCrudo, referencia, proveedor, metodo, idTransaccionPasarela }) {
    const usuario = exigirIdUsuario(idUsuario);
    const monto = exigirMontoEntero(montoCrudo);
    if (monto > MONTO_MAXIMO_DEPOSITO) throw invalido('Ingresa un monto válido');

    const ref = String(referencia ?? '').trim();
    if (!ref) throw invalido('La referencia del pago es obligatoria');
    if (ref.length > 100) throw invalido('La referencia del pago no es válida');

    const resultado = await repo.acreditarDeposito({
      idUsuario: usuario,
      monto,
      referencia: ref,
      proveedor: textoOpcional(proveedor, 50),
      metodo: textoOpcional(metodo, 50),
      idTransaccionPasarela: textoOpcional(idTransaccionPasarela, 100),
    });

    if (resultado.conflicto) {
      throw yaExiste('La referencia del pago ya se usó en otro movimiento');
    }

    if (resultado.aplicado) {
      log?.info(`Deposito ${ref} acreditado: usuario ${usuario}, ${monto} COP`);
    } else {
      log?.info(`Deposito ${ref} ya estaba acreditado: reintento ignorado`);
    }

    return { aplicado: resultado.aplicado, billetera: resultado.billetera };
  }

  return { asegurar, obtener, acreditarDeposito };
}
