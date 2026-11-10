/**
 * Servicio minimo para probar probarArranque(): arranca un servidor gRPC con
 * la definicion de ms-transacciones, solo implementa Salud, y lee su puerto de
 * GRPC_PUERTO como lo haria cualquier microservicio real.
 */

import { crearServidorGrpc, crearLogger, crearRpcSalud, apagadoOrdenado } from '../../../src/index.js';
import { implementacionParcial } from '../../../src/pruebas.js';

const log = crearLogger('servicio-falso');
const servidor = crearServidorGrpc({ nombre: 'servicio-falso', log });

servidor.registrar(
  'transacciones',
  implementacionParcial('transacciones', {
    Salud: crearRpcSalud({
      servicio: 'servicio-falso',
      motor: 'Ninguno',
      baseDatos: 'memoria',
      comprobar: async () => {
        throw new Error('base inalcanzable a proposito');
      },
    }),
  })
);

const puerto = await servidor.iniciar(Number(process.env.GRPC_PUERTO), process.env.GRPC_HOST ?? '127.0.0.1');
log.info(`escuchando en ${puerto}`);
apagadoOrdenado({ log, tareas: [() => servidor.apagar(1000)] });
