/**
 * Los seis clientes gRPC del BFF.
 *
 * Se crean UNA vez al arrancar (index.js) y se le pasan a crearApp(). Las
 * pruebas no usan este modulo: arman los clientes apuntando a servidores falsos
 * en puertos aleatorios, y la app no nota la diferencia.
 *
 * Todo cliente lleva plazo (deadline). Sin plazo, un servicio colgado deja
 * colgada la peticion HTTP para siempre y el navegador espera sin saber nada.
 * 5 s alcanzan para cualquier consulta; crear un pago y subir una imagen hablan
 * con Wompi o con Drive por internet, y por eso tienen su propio plazo.
 */

import { crearClienteGrpc } from '@goldorado/comun';

export const PLAZOS = Object.freeze({
  normal: 5000,
  salud: 2500,
  pago: 25000,
  subida: 15000,
  descarga: 30000,
});

/** clave del servicio -> variable de entorno con su direccion. */
export const DIRECCIONES = Object.freeze({
  autenticacion: 'MS_AUTENTICACION_URL',
  deportes: 'MS_DEPORTES_URL',
  apuestas: 'MS_APUESTAS_URL',
  transacciones: 'MS_TRANSACCIONES_URL',
  pagos: 'MS_PAGOS_URL',
  imagenes: 'MS_IMAGENES_URL',
});

export function crearClientes(env, { direcciones = {} } = {}) {
  const clientes = {};
  for (const [clave, variable] of Object.entries(DIRECCIONES)) {
    clientes[clave] = crearClienteGrpc(clave, {
      direccion: direcciones[clave] ?? env[variable],
      tokenInterno: env.GRPC_TOKEN_INTERNO ?? '',
      plazoMs: PLAZOS.normal,
    });
  }
  return clientes;
}

export function cerrarClientes(clientes) {
  for (const cliente of Object.values(clientes ?? {})) {
    try {
      cliente?.cerrar?.();
    } catch {
      // cerrar un canal ya cerrado no es un problema
    }
  }
}
