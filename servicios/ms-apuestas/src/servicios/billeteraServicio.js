/**
 * Reglas de la billetera: crearla, consultarla y acreditar depositos.
 *
 * AcreditarDeposito la llama ms-pagos cuando Wompi aprueba un pago, y puede
 * llegar dos veces (webhook + conciliacion). La idempotencia la garantiza la
 * base (UNIQUE de movimiento_saldo.referencia); aqui se valida la entrada y se
 * traduce el resultado. No se escribe evento en la bandeja de salida: el ciclo
 * de vida del DEPOSITO en el libro de MongoDB es de ms-pagos.
 */

import { formatearCOP, invalido, noEncontrado, precondicion, yaExiste } from '@goldorado/comun';
import { exigirIdUsuario, exigirMontoEntero, textoOpcional } from '../utils/validacion.js';

// NUMERIC(18,2) admite hasta 16 digitos enteros; mas alla la base fallaria con
// un error generico. Ningun pago real se acerca.
const MONTO_MAXIMO_DEPOSITO = 9_999_999_999_999;

export const MONTO_MINIMO_RETIRO = 10_000;
export const TIPOS_CUENTA = Object.freeze(['AHORROS', 'CORRIENTE']);
const PROVEEDOR_RETIRO = 'Transferencia simulada';

/**
 * Valida el retiro y devuelve los datos normalizados. El numero de cuenta solo
 * sale de aqui enmascarado ('****1234'): no se guarda completo en ningun lado.
 */
export function validarRetiro({ monto: montoCrudo, banco, tipoCuenta, numeroCuenta }) {
  const monto = exigirMontoEntero(montoCrudo);
  if (monto > MONTO_MAXIMO_DEPOSITO) throw invalido('Ingresa un monto válido');
  if (monto < MONTO_MINIMO_RETIRO) {
    throw invalido(`El monto mínimo de retiro es ${formatearCOP(MONTO_MINIMO_RETIRO)}`);
  }

  const nombreBanco = String(banco ?? '').trim();
  if (!nombreBanco) throw invalido('Selecciona el banco de destino');
  if (nombreBanco.length > 60) throw invalido('El nombre del banco no es válido');

  const tipo = String(tipoCuenta ?? '').trim().toUpperCase();
  if (!TIPOS_CUENTA.includes(tipo)) throw invalido('El tipo de cuenta debe ser AHORROS o CORRIENTE');

  const cuenta = String(numeroCuenta ?? '').trim();
  if (!/^\d{6,20}$/.test(cuenta)) throw invalido('El número de cuenta debe tener entre 6 y 20 dígitos');

  return { monto, banco: nombreBanco, tipoCuenta: tipo, cuentaEnmascarada: `****${cuenta.slice(-4)}` };
}

/** @param {{ repo: object, log?: object, ahora?: () => Date }} o */
export function crearServicioBilletera({ repo, log, ahora = () => new Date() }) {
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

  /**
   * Retiro a cuenta bancaria (transferencia SIMULADA). Se valida todo antes de
   * abrir la transaccion; el saldo lo comprueba el UPDATE del repositorio.
   * referencia 'RET-<idUsuario>-<epochMs>' = codigo del documento en Mongo.
   */
  async function solicitarRetiro({ idUsuario, monto: montoCrudo, banco, tipoCuenta, numeroCuenta }) {
    const usuario = exigirIdUsuario(idUsuario);
    const datos = validarRetiro({ monto: montoCrudo, banco, tipoCuenta, numeroCuenta });
    const referencia = `RET-${usuario}-${ahora().getTime()}`;

    const cargaEvento = ({ fecha }) => ({
      codigo: referencia,
      idUsuario: usuario,
      tipo: 'RETIRO',
      estado: 'COMPLETADO',
      monto: datos.monto,
      moneda: 'COP',
      origen: 'ms-apuestas',
      referenciaExterna: `${datos.banco} ${datos.cuentaEnmascarada}`,
      proveedor: PROVEEDOR_RETIRO,
      metodo: datos.tipoCuenta,
      ejecutadoPor: 'RETIRO_WEB',
      fecha,
    });

    const resultado = await repo.solicitarRetiro({
      idUsuario: usuario,
      monto: datos.monto,
      referencia,
      proveedor: PROVEEDOR_RETIRO,
      metodo: datos.tipoCuenta,
      cargaEvento,
    });
    if (!resultado) throw precondicion('Saldo insuficiente');

    log?.info(`Retiro ${referencia}: usuario ${usuario}, ${formatearCOP(datos.monto)} a ${datos.banco} ${datos.cuentaEnmascarada}`);
    return { referencia, monto: datos.monto, billetera: resultado.billetera, fecha: resultado.fecha };
  }

  return { asegurar, obtener, acreditarDeposito, solicitarRetiro };
}
