// =============================================================================
//  Reglas del libro de movimientos (coleccion `transacciones`).
//
//  La regla de oro viene de CONVENCIONES §4: un reintento NUNCA duplica
//  dinero. RegistrarTransaccion es idempotente por `codigo` (UUID de la
//  apuesta o referencia del pago): el outbox de ms-apuestas y la conciliacion
//  de ms-pagos pueden repetir la llamada las veces que quieran.
//
//  Fabrica con dependencias inyectadas (repo, reloj) para probarla sin base.
// =============================================================================

import { aNumero, invalido, noEncontrado, precondicion } from '@goldorado/comun';
import { ESTADOS_TRANSACCION, TIPOS_TRANSACCION } from '../esquema.js';
import {
  claveObligatoria,
  claveOpcional,
  enumerado,
  fechaOpcional,
  idObligatorio,
  limite,
  textoOpcional,
} from '../utils/entrada.js';
import { aEntero } from '../utils/mapeo.js';

export const NO_ENCONTRADA = 'Transacción no encontrada';
const MENSAJE_CODIGO = 'El código de la transacción es obligatorio (máximo 150 caracteres)';
const MENSAJE_TIPO = `Tipo de transacción inválido: usa ${TIPOS_TRANSACCION.join(', ')}`;
const MENSAJE_ESTADO = `Estado de transacción inválido: usa ${ESTADOS_TRANSACCION.join(', ')}`;
const MONTO_MAXIMO = 1e16; // DECIMAL(18,2): 16 digitos enteros

// Datos que pueden llegar DESPUES del registro (p. ej. el id de Wompi llega
// con el webhook): si faltaban, un registro posterior los completa.
const CAMPOS_COMPLETABLES = ['referenciaExterna', 'proveedor', 'metodo'];

/** El signo lo da el tipo: un monto de 0 o negativo no existe (CHK_Transaccion_Monto). */
export function validarMonto(valor) {
  const n = Number(valor);
  const redondeado = Math.round(n * 100) / 100; // dos decimales, como DECIMAL(18,2)
  if (!Number.isFinite(n) || redondeado <= 0 || redondeado >= MONTO_MAXIMO) {
    throw invalido('Ingresa un monto válido');
  }
  return redondeado;
}

export function validarRegistro(req, ahora) {
  const moneda = (textoOpcional(req.moneda) ?? 'COP').toUpperCase();
  if (!/^[A-Z]{3}$/.test(moneda)) throw invalido('Moneda inválida');
  return {
    codigo: claveObligatoria(req.codigo, 150, MENSAJE_CODIGO),
    idUsuario: idObligatorio(req.idUsuario, 'El usuario de la transacción es obligatorio'),
    tipo: enumerado(req.tipo, TIPOS_TRANSACCION, { mensaje: MENSAJE_TIPO }),
    // DF_Transaccion_Estado: si no lo dicen, COMPLETADO (como el monolito).
    estado: enumerado(req.estado, ESTADOS_TRANSACCION, { defecto: 'COMPLETADO', mensaje: MENSAJE_ESTADO }),
    monto: validarMonto(req.monto),
    moneda,
    origen: textoOpcional(req.origen, 50) ?? 'desconocido',
    referenciaExterna: claveOpcional(req.referenciaExterna, 150, 'La referencia externa es demasiado larga'),
    proveedor: textoOpcional(req.proveedor, 50),
    metodo: textoOpcional(req.metodo, 50),
    // DF_LogTransaccion_Por: quien no se identifica es el SISTEMA.
    ejecutadoPor: textoOpcional(req.ejecutadoPor, 50) ?? 'SISTEMA',
    payload: textoOpcional(req.payload),
    fecha: fechaOpcional(req.fecha, ahora),
  };
}

export function validarActualizacion(req) {
  return {
    codigo: claveObligatoria(req.codigo, 150, MENSAJE_CODIGO),
    estadoNuevo: enumerado(req.estadoNuevo, ESTADOS_TRANSACCION, { mensaje: MENSAJE_ESTADO }),
    ejecutadoPor: textoOpcional(req.ejecutadoPor, 50) ?? 'SISTEMA',
    codigoError: textoOpcional(req.codigoError, 50),
    payload: textoOpcional(req.payload),
  };
}

export function validarListado(req) {
  return {
    idUsuario: idObligatorio(req.idUsuario, 'El usuario es obligatorio para listar sus transacciones'),
    tipo: textoOpcional(req.tipo) ? enumerado(req.tipo, TIPOS_TRANSACCION, { mensaje: MENSAJE_TIPO }) : undefined,
    limite: limite(req.limite, 20, 100),
  };
}

/**
 * Que hacer cuando el codigo YA existe (decision pura, sin base):
 *  - 'conflicto'       mismo codigo pero otro usuario, tipo o monto: no es un
 *                      reintento sino un error del llamador; devolver la
 *                      existente callado escondería, p. ej., un PREMIO perdido.
 *  - 'igual'           reintento exacto: se devuelve tal cual, sin escribir.
 *  - 'cambiar-estado'  el estado cambio: se agrega al historial.
 *  - 'completar'       mismo estado, pero trae datos que faltaban.
 */
export function decidirRegistro(existente, datos) {
  const distintos = [];
  if (aEntero(existente.idUsuario) !== datos.idUsuario) distintos.push('idUsuario');
  if (existente.tipo !== datos.tipo) distintos.push('tipo');
  if (aNumero(existente.monto) !== datos.monto) distintos.push('monto');
  if (distintos.length > 0) return { accion: 'conflicto', distintos };

  const completar = {};
  for (const campo of CAMPOS_COMPLETABLES) {
    if (datos[campo] && !existente[campo]) completar[campo] = datos[campo];
  }
  if (existente.estado !== datos.estado) return { accion: 'cambiar-estado', completar };
  if (Object.keys(completar).length > 0) return { accion: 'completar', completar };
  return { accion: 'igual' };
}

/**
 * @param {object} o
 * @param {ReturnType<import('../repositorios/transacciones.js').crearRepositorioTransacciones>} o.repo
 * @param {() => Date} [o.reloj]
 */
export function crearServicioTransacciones({ repo, reloj = () => new Date(), reintentos = 3 }) {
  /**
   * Escritura con control optimista: `decidir(actual, ahora)` dice que
   * cambiar (o null = nada). Si otro proceso movio el estado entre la lectura
   * y la escritura, se relee y se decide de nuevo.
   */
  async function conReintento(codigo, inicial, decidir) {
    let actual = inicial;
    for (let intento = 0; intento < reintentos; intento += 1) {
      if (!actual) throw noEncontrado(NO_ENCONTRADA);
      const ahora = reloj();
      const cambio = decidir(actual, ahora);
      if (!cambio) return actual;
      const resultado = await repo.aplicarCambio({ codigo, estadoEsperado: actual.estado, fecha: ahora, ...cambio });
      if (resultado) return resultado;
      actual = await repo.buscarPorCodigo(codigo);
    }
    throw precondicion('La transacción cambió mientras se actualizaba; intenta de nuevo');
  }

  return {
    async registrar(req) {
      const datos = validarRegistro(req, reloj());
      const { documento, creada } = await repo.insertarSiNoExiste(datos);
      if (creada) return documento;

      return conReintento(datos.codigo, documento, (actual, ahora) => {
        const decision = decidirRegistro(actual, datos);
        if (decision.accion === 'conflicto') {
          throw precondicion('Ya existe una transacción con ese código y otros datos', {
            codigo: datos.codigo,
            distintos: decision.distintos,
          });
        }
        if (decision.accion === 'igual') return null;
        const cambiaEstado = decision.accion === 'cambiar-estado';
        return {
          estadoNuevo: datos.estado,
          completar: decision.completar,
          entrada: cambiaEstado
            ? {
                estadoAnterior: actual.estado,
                estadoNuevo: datos.estado,
                fecha: ahora,
                ejecutadoPor: datos.ejecutadoPor,
                payload: datos.payload,
              }
            : undefined,
        };
      });
    },

    async actualizarEstado(req) {
      const datos = validarActualizacion(req);
      const actual = await repo.buscarPorCodigo(datos.codigo);
      return conReintento(datos.codigo, actual, (doc, ahora) => {
        if (doc.estado === datos.estadoNuevo) return null; // mismo estado: no ensucia el historial
        return {
          estadoNuevo: datos.estadoNuevo,
          entrada: {
            estadoAnterior: doc.estado,
            estadoNuevo: datos.estadoNuevo,
            fecha: ahora,
            ejecutadoPor: datos.ejecutadoPor,
            codigoError: datos.codigoError,
            payload: datos.payload,
          },
        };
      });
    },

    listar(req) {
      return repo.listarPorUsuario(validarListado(req));
    },

    async obtener(req) {
      const codigo = claveObligatoria(req.codigo, 150, MENSAJE_CODIGO);
      const documento = await repo.buscarPorCodigo(codigo);
      if (!documento) throw noEncontrado(NO_ENCONTRADA);
      return documento;
    },
  };
}
