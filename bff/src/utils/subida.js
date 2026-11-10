/**
 * Recepcion de imagenes (multipart) con multer, EN MEMORIA.
 *
 * El BFF no guarda archivos: recibe los bytes, los valida y se los pasa a
 * ms-imagenes por gRPC, que es quien habla con Drive. Por eso memoryStorage y
 * no disco. El limite de 5 MB lo aplica multer mientras lee (LIMIT_FILE_SIZE),
 * antes de que un archivo de 2 GB llene la memoria del proceso.
 *
 * El tipo se revisa DESPUES de leer, con un mensaje propio: el fileFilter de
 * multer solo puede rechazar en silencio o con un error generico.
 */

import multer from 'multer';

import { ErrorHttp } from './apiResult.js';

export const CINCO_MB = 5 * 1024 * 1024;

export const TIPOS_FOTO = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
export const TIPOS_ADMIN = Object.freeze([...TIPOS_FOTO, 'image/svg+xml']);

export function crearSubida() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CINCO_MB, files: 1, fields: 10, fieldSize: 10 * 1024 },
  });
}

/** Lanza ErrorHttp 400 si falta el archivo o el tipo no esta permitido. */
export function validarArchivo(archivo, tiposPermitidos) {
  if (!archivo || !archivo.buffer?.length) {
    throw new ErrorHttp(400, 'Adjunta una imagen en el campo "imagen"');
  }
  if (!tiposPermitidos.includes(archivo.mimetype)) {
    const nombres = tiposPermitidos.map((t) => t.replace('image/', '').replace('+xml', '').toUpperCase());
    throw new ErrorHttp(400, `La imagen debe ser ${nombres.join(', ')}`);
  }
  return archivo;
}
