/**
 * Carga de los contratos .proto (carpeta proto/ en la raiz del monorepo).
 *
 * Se cargan EN TIEMPO DE EJECUCION con @grpc/proto-loader, sin generar codigo:
 * cambiar un .proto y reiniciar es suficiente. Los servicios y el BFF leen
 * exactamente los mismos archivos, asi que no pueden desincronizarse.
 *
 * OPCIONES (iguales en todos los procesos):
 *   keepCase:false   id_usuario -> idUsuario en JavaScript
 *   longs:Number     int64 -> number (los ids no se acercan a 2^53)
 *   enums:String     (no hay enums todavia, pero si aparecen: por nombre)
 *   defaults:true    un string vacio llega como '' y no como undefined...
 *   oneofs:true      ...salvo los campos `optional`, que si no vienen quedan
 *                    undefined: asi se distingue "0 goles" de "sin marcador".
 */

import grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** paquetes/comun/src/grpc -> raiz del monorepo -> proto/ */
export const RUTA_PROTOS =
  process.env.PROTO_DIR?.trim() || fileURLToPath(new URL('../../../../proto/', import.meta.url));

export const OPCIONES_PROTO = Object.freeze({
  keepCase: false,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [RUTA_PROTOS],
});

/**
 * Catalogo de los seis microservicios: archivo, ruta del servicio dentro del
 * paquete protobuf, nombre para logs y puerto por defecto.
 */
export const SERVICIOS = Object.freeze({
  autenticacion: {
    archivo: 'autenticacion.proto',
    ruta: 'goldorado.autenticacion.Autenticacion',
    nombre: 'ms-autenticacion',
    puerto: 50051,
  },
  deportes: {
    archivo: 'deportes.proto',
    ruta: 'goldorado.deportes.Deportes',
    nombre: 'ms-deportes',
    puerto: 50052,
  },
  apuestas: {
    archivo: 'apuestas.proto',
    ruta: 'goldorado.apuestas.Apuestas',
    nombre: 'ms-apuestas',
    puerto: 50053,
  },
  transacciones: {
    archivo: 'transacciones.proto',
    ruta: 'goldorado.transacciones.Transacciones',
    nombre: 'ms-transacciones',
    puerto: 50054,
  },
  pagos: {
    archivo: 'pagos.proto',
    ruta: 'goldorado.pagos.Pagos',
    nombre: 'ms-pagos',
    puerto: 50055,
  },
  imagenes: {
    archivo: 'imagenes.proto',
    ruta: 'goldorado.imagenes.Imagenes',
    nombre: 'ms-imagenes',
    puerto: 50056,
  },
});

const cache = new Map();

/** Objeto de paquete gRPC de un archivo .proto (con cache). */
export function cargarPaquete(archivo) {
  if (!cache.has(archivo)) {
    const definicion = loadSync(join(RUTA_PROTOS, archivo), OPCIONES_PROTO);
    cache.set(archivo, grpc.loadPackageDefinition(definicion));
  }
  return cache.get(archivo);
}

/**
 * Constructor del servicio (sirve como cliente y su `.service` es la
 * definicion que se registra en el servidor).
 *
 *   const Deportes = constructorServicio('deportes');
 *   Deportes.service.ListarEncuentros  // definicion del metodo
 */
export function constructorServicio(clave) {
  const info = SERVICIOS[clave];
  if (!info) throw new Error(`Servicio desconocido: ${clave}. Validos: ${Object.keys(SERVICIOS).join(', ')}`);
  const paquete = cargarPaquete(info.archivo);
  const Constructor = info.ruta.split('.').reduce((nodo, parte) => nodo?.[parte], paquete);
  if (typeof Constructor !== 'function') throw new Error(`No se encontro ${info.ruta} en ${info.archivo}`);
  return Constructor;
}
