/**
 * Ayudantes SOLO PARA PRUEBAS (node:test). Ningun servicio los importa en
 * produccion.
 *
 * Existen para que cada microservicio pruebe su arranque real en ~20 lineas:
 *
 *   const { salud, detener } = await probarArranque({
 *     cwd: raizDelServicio,
 *     clave: 'deportes',
 *     env: { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1' },   // base inalcanzable a proposito
 *   });
 *   assert.equal(salud.servicio, 'ms-deportes');
 *   await detener();
 *
 * y para que las pruebas con servidores falsos no tengan que escribir los ~20
 * metodos de un .proto cuando solo les interesan dos (implementacionParcial).
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import { join } from 'node:path';

import grpc from '@grpc/grpc-js';

import { constructorServicio } from './grpc/proto.js';
import { crearClienteGrpc } from './grpc/cliente.js';
import { ErrorNegocio } from './errores.js';

/** Un puerto TCP libre en 127.0.0.1 (lo pide al sistema operativo). */
export function puertoLibre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.unref();
    servidor.on('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera hasta que algo escuche en host:puerto (o se acabe el plazo). */
export async function esperarPuerto(puerto, { host = '127.0.0.1', plazoMs = 15000 } = {}) {
  const limite = Date.now() + plazoMs;
  while (Date.now() < limite) {
    const abierto = await new Promise((resolve) => {
      const socket = net.connect({ port: puerto, host });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (abierto) return true;
    await esperar(150);
  }
  throw new Error(`Nadie escucho en ${host}:${puerto} en ${plazoMs} ms`);
}

/**
 * Lanza `node <script>` como proceso hijo con un entorno controlado.
 * Guarda stdout/stderr para mostrarlos si la prueba falla.
 */
export function lanzarProceso({ cwd, script = join('src', 'index.js'), env = {} }) {
  const hijo = spawn(process.execPath, [script], {
    cwd,
    env: { ...process.env, NODE_ENV: 'test', LOG_NIVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let salida = '';
  hijo.stdout.on('data', (d) => {
    salida += d;
  });
  hijo.stderr.on('data', (d) => {
    salida += d;
  });

  async function detener() {
    if (hijo.exitCode !== null || hijo.signalCode !== null) return;
    const termino = new Promise((resolve) => hijo.once('exit', resolve));
    hijo.kill(); // en Windows es un TerminateProcess: no hay SIGTERM real
    await Promise.race([termino, esperar(3000)]);
  }

  return { hijo, detener, salida: () => salida, vivo: () => hijo.exitCode === null && hijo.signalCode === null };
}

/**
 * Arranca un microservicio de verdad, espera su puerto gRPC y llama `Salud`.
 *
 * @param {object} o
 * @param {string} o.cwd    carpeta raiz del servicio (la que tiene package.json)
 * @param {string} o.clave  'autenticacion' | 'deportes' | 'apuestas' | 'transacciones' | 'pagos' | 'imagenes'
 * @param {object} [o.env]  variables extra (base inalcanzable, modos sin nube...)
 * @returns {Promise<{ salud, puerto, proceso, cliente, detener }>}
 */
export async function probarArranque({ cwd, clave, env = {}, plazoMs = 20000 }) {
  const puerto = await puertoLibre();
  const proceso = lanzarProceso({
    cwd,
    env: { GRPC_HOST: '127.0.0.1', GRPC_PUERTO: String(puerto), GRPC_TOKEN_INTERNO: '', ...env },
  });

  const detener = async () => {
    cliente?.cerrar();
    await proceso.detener();
  };

  let cliente;
  try {
    await esperarPuerto(puerto, { plazoMs });
    cliente = crearClienteGrpc(clave, { direccion: `127.0.0.1:${puerto}`, plazoMs: 8000 });
    const salud = await cliente.Salud({});
    return { salud, puerto, proceso, cliente, detener };
  } catch (error) {
    await detener();
    error.message += `\n--- salida del proceso ---\n${proceso.salida()}`;
    throw error;
  }
}

/**
 * Implementacion de un servicio donde SOLO importan algunos metodos: el resto
 * responde UNIMPLEMENTED. Sirve para servidores falsos en pruebas, porque
 * crearServidorGrpc().registrar() exige todos los metodos del .proto.
 */
export function implementacionParcial(clave, metodos = {}) {
  const definicion = constructorServicio(clave).service;
  const completa = {};
  for (const nombre of Object.keys(definicion)) {
    completa[nombre] =
      metodos[nombre] ??
      (async () => {
        throw new ErrorNegocio(grpc.status.UNIMPLEMENTED, `${nombre} no esta implementado en esta prueba`);
      });
  }
  return completa;
}
