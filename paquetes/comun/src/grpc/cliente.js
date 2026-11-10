/**
 * Cliente gRPC "con promesas" para hablar con otro microservicio.
 *
 *   const deportes = crearClienteGrpc('deportes', { direccion: 'localhost:50052' });
 *   const encuentro = await deportes.ObtenerEncuentro({ id: 7 });
 *
 * Los metodos se llaman IGUAL que en el .proto (PascalCase). Los unarios
 * devuelven una promesa; los de streaming de servidor devuelven el stream.
 *
 * TODA llamada lleva un plazo (deadline). Sin plazo, un servicio colgado deja
 * colgado al que lo llama, y a quien llamo a ese, hasta el navegador: un
 * spinner eterno repartido en tres procesos.
 *
 * Los errores salen con dos campos extra para que aErrorGrpc los reconozca:
 *   error.servicioOrigen = 'ms-deportes'
 *   error.metodo         = 'ObtenerEncuentro'
 *
 * La conexion es perezosa: crear el cliente no conecta nada. Si el otro
 * servicio no esta arriba, la llamada falla con UNAVAILABLE y no se cae nadie.
 */

import grpc from '@grpc/grpc-js';

import { SERVICIOS, constructorServicio } from './proto.js';

const OCHO_MB = 8 * 1024 * 1024;

/**
 * @param {string} clave  'autenticacion' | 'deportes' | 'apuestas' | 'transacciones' | 'pagos' | 'imagenes'
 * @param {object} opciones
 * @param {string} opciones.direccion      'localhost:50052'
 * @param {string} [opciones.tokenInterno] se envia como metadato x-token-interno
 * @param {number} [opciones.plazoMs]      deadline por defecto de cada llamada
 * @param {number} [opciones.maxMensajeBytes]
 */
export function crearClienteGrpc(clave, { direccion, tokenInterno = '', plazoMs = 5000, maxMensajeBytes = OCHO_MB } = {}) {
  const info = SERVICIOS[clave];
  const Constructor = constructorServicio(clave);
  const destino = direccion || `localhost:${info.puerto}`;

  const cliente = new Constructor(destino, grpc.credentials.createInsecure(), {
    'grpc.max_receive_message_length': maxMensajeBytes,
    'grpc.max_send_message_length': maxMensajeBytes,
  });

  const metadatos = (opciones) => {
    const md = new grpc.Metadata();
    if (tokenInterno) md.set('x-token-interno', tokenInterno);
    if (opciones?.idSolicitud) md.set('x-id-solicitud', String(opciones.idSolicitud));
    return md;
  };

  const plazo = (opciones) => new Date(Date.now() + (opciones?.plazoMs ?? plazoMs));

  const api = {
    servicio: info.nombre,
    direccion: destino,
    cerrar: () => cliente.close(),
  };

  for (const [metodo, definicion] of Object.entries(Constructor.service)) {
    if (definicion.responseStream) {
      api[metodo] = (peticion = {}, opciones = {}) => {
        const stream = cliente[metodo](peticion, metadatos(opciones), { deadline: plazo(opciones) });
        // Se marca el error igual que en los unarios, sin tragarselo.
        stream.on('error', (error) => {
          error.servicioOrigen = info.nombre;
          error.metodo = metodo;
        });
        return stream;
      };
      continue;
    }

    api[metodo] = (peticion = {}, opciones = {}) =>
      new Promise((resolve, reject) => {
        cliente[metodo](peticion, metadatos(opciones), { deadline: plazo(opciones) }, (error, respuesta) => {
          if (error) {
            error.servicioOrigen = info.nombre;
            error.metodo = metodo;
            reject(error);
            return;
          }
          resolve(respuesta);
        });
      });
  }

  return api;
}

/**
 * Llamada que NO debe tumbar la operacion principal si falla: registrar un
 * intento de sesion en Mongo no puede impedir que alguien inicie sesion.
 * Devuelve la respuesta o null, y deja constancia en el log.
 */
export async function llamadaOpcional(promesa, log, descripcion) {
  try {
    return await promesa;
  } catch (error) {
    log?.aviso(`${descripcion} fallo (se continua sin eso): ${error.details ?? error.message}`);
    return null;
  }
}
