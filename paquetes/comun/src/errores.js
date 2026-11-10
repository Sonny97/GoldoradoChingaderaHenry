/**
 * Errores de negocio y su traduccion a estados gRPC.
 *
 * REGLA DE TODO EL SISTEMA
 *   - Un error de NEGOCIO (clave incorrecta, saldo insuficiente, correo
 *     repetido) se LANZA como ErrorNegocio con un codigo gRPC y un mensaje en
 *     español listo para mostrarle al usuario.
 *   - Cualquier otra excepcion (base caida, bug) se traduce aqui: el detalle
 *     tecnico se queda en el log del servicio y hacia afuera sale un mensaje
 *     generico. El texto crudo de un error de SQL revela nombres de tablas y
 *     restricciones: es media radiografia del esquema.
 *
 * El BFF convierte el codigo gRPC en el codigo HTTP correspondiente (ver
 * bff/src/utils/grpcHttp.js) y el mensaje en el sobre { success:false, message }.
 */

import grpc from '@grpc/grpc-js';

import { traducirErrorBaseDatos } from './baseDatos.js';

export const CODIGOS = grpc.status;

export class ErrorNegocio extends Error {
  /**
   * @param {number|string} codigo  grpc.status.X o su nombre ('NOT_FOUND')
   * @param {string} mensaje        texto para el usuario final, en español
   * @param {object|null} datos     datos extra; viajan en el metadato `x-datos`
   */
  constructor(codigo, mensaje, datos = null) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.codigo = typeof codigo === 'string' ? grpc.status[codigo] : codigo;
    if (this.codigo === undefined) throw new Error(`Codigo gRPC desconocido: ${codigo}`);
    this.datos = datos;
  }
}

export const noEncontrado = (mensaje, datos) => new ErrorNegocio(grpc.status.NOT_FOUND, mensaje, datos);
export const yaExiste = (mensaje, datos) => new ErrorNegocio(grpc.status.ALREADY_EXISTS, mensaje, datos);
export const invalido = (mensaje, datos) => new ErrorNegocio(grpc.status.INVALID_ARGUMENT, mensaje, datos);
export const precondicion = (mensaje, datos) =>
  new ErrorNegocio(grpc.status.FAILED_PRECONDITION, mensaje, datos);
export const noAutenticado = (mensaje, datos) =>
  new ErrorNegocio(grpc.status.UNAUTHENTICATED, mensaje, datos);
export const sinPermiso = (mensaje, datos) =>
  new ErrorNegocio(grpc.status.PERMISSION_DENIED, mensaje, datos);
export const noDisponible = (mensaje, datos) => new ErrorNegocio(grpc.status.UNAVAILABLE, mensaje, datos);
export const demasiados = (mensaje, datos) =>
  new ErrorNegocio(grpc.status.RESOURCE_EXHAUSTED, mensaje, datos);

/**
 * ¿Es un error que llego de OTRO microservicio a traves de nuestro cliente?
 * (crearClienteGrpc le pone `servicioOrigen`). Esos se propagan tal cual:
 * si ms-deportes dice NOT_FOUND "Partido no encontrado", ms-apuestas no tiene
 * por que inventarse otro mensaje.
 */
export function esErrorDeOtroServicio(error) {
  return Boolean(error?.servicioOrigen) && typeof error?.code === 'number';
}

/**
 * JSON en ASCII puro: los metadatos gRPC de texto SOLO aceptan ASCII imprimible.
 * Un "Ingresa un correo válido" metido tal cual hace que Metadata.set() lance
 * DENTRO del manejo del error, y el servicio muere por una promesa rechazada.
 * Se escapan como \uXXXX, que JSON.parse (datosDeError) vuelve a convertir.
 */
export function jsonAscii(valor) {
  return JSON.stringify(valor).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/** Metadato de cierre con los datos extra del error, si los hay. */
function metadatosCon(datos) {
  const metadatos = new grpc.Metadata();
  if (datos !== null && datos !== undefined) metadatos.set('x-datos', jsonAscii(datos));
  return metadatos;
}

/**
 * Convierte cualquier excepcion en el objeto de error que entiende grpc-js:
 * { code, details, metadata }.
 */
export function aErrorGrpc(error, { servicio = 'servicio', log, metodo = '' } = {}) {
  if (error instanceof ErrorNegocio) {
    return { code: error.codigo, details: error.message, metadata: metadatosCon(error.datos) };
  }

  if (esErrorDeOtroServicio(error)) {
    // Un UNAVAILABLE de abajo se reescribe con el nombre del servicio caido:
    // "No connection established" no le dice nada a nadie.
    if (error.code === grpc.status.UNAVAILABLE || error.code === grpc.status.DEADLINE_EXCEEDED) {
      log?.aviso(`${metodo}: ${error.servicioOrigen} no respondio (${error.details})`);
      return {
        code: grpc.status.UNAVAILABLE,
        details: `El servicio ${error.servicioOrigen} no está disponible en este momento`,
        metadata: metadatosCon(null),
      };
    }
    const metadatos = new grpc.Metadata();
    const datos = error.metadata?.get?.('x-datos')?.[0];
    if (datos) metadatos.set('x-datos', String(datos));
    return { code: error.code, details: error.details, metadata: metadatos };
  }

  const deBaseDatos = traducirErrorBaseDatos(error);
  if (deBaseDatos) {
    log?.aviso(`${metodo}: ${deBaseDatos.mensaje} -> ${error?.message ?? error}`);
    return { code: deBaseDatos.codigo, details: deBaseDatos.mensaje, metadata: metadatosCon(null) };
  }

  log?.error(`${metodo}: error inesperado`, error);
  return {
    code: grpc.status.INTERNAL,
    details: `Ocurrió un error inesperado en ${servicio}`,
    metadata: metadatosCon(null),
  };
}

/** Lee los datos extra (`x-datos`) de un error gRPC recibido. */
export function datosDeError(error) {
  try {
    const valor = error?.metadata?.get?.('x-datos')?.[0];
    return valor ? JSON.parse(String(valor)) : null;
  } catch {
    return null;
  }
}
