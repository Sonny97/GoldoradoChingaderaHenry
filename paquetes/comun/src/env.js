/**
 * Lectura y VALIDACION de variables de entorno, comun a todos los procesos.
 *
 * Igual que en el proyecto monolitico: falla AL ARRANCAR diciendo exactamente
 * que variable falta, en vez de explotar media hora despues con un error de
 * conexion que no dice nada.
 *
 * Cada servicio declara su esquema en src/config/env.js:
 *
 *   export const env = cargarEnv(import.meta.url, {
 *     GRPC_PUERTO:  { tipo: 'entero', defecto: 50051 },
 *     DB_PASSWORD:  { requerida: true, secreta: true },
 *     DB_ENCRYPT:   { tipo: 'booleano', defecto: false },
 *     CORS_ORIGIN:  { tipo: 'lista', defecto: ['http://localhost:3003'] },
 *   });
 *
 * EL .env SE BUSCA EN LA RAIZ DEL PAQUETE que llama (la carpeta que tiene su
 * package.json), con ruta ABSOLUTA calculada desde import.meta.url. Con una ruta
 * relativa, `npm run dev -w ...` (que corre desde la raiz del monorepo) y
 * `node src/index.js` (que corre desde la carpeta del servicio) buscarian el
 * archivo en lugares distintos y uno de los dos diria que faltan variables que
 * si estan escritas.
 */

import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sube desde el archivo hasta encontrar la carpeta que tiene package.json. */
export function raizDelPaquete(urlArchivo) {
  let dir = dirname(fileURLToPath(urlArchivo));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const padre = dirname(dir);
    if (padre === dir) throw new Error(`No se encontro package.json por encima de ${urlArchivo}`);
    dir = padre;
  }
}

const VERDADEROS = new Set(['true', '1', 'yes', 'si', 'sí', 'on']);

function convertir(nombre, crudo, regla, errores) {
  const tipo = regla.tipo ?? 'texto';
  switch (tipo) {
    case 'texto':
      return crudo;
    case 'entero': {
      const n = Number(crudo);
      if (!Number.isInteger(n)) {
        errores.push(`${nombre} debe ser un numero entero (llego "${crudo}")`);
        return regla.defecto;
      }
      return n;
    }
    case 'decimal': {
      const n = Number(crudo);
      if (!Number.isFinite(n)) {
        errores.push(`${nombre} debe ser un numero (llego "${crudo}")`);
        return regla.defecto;
      }
      return n;
    }
    case 'booleano':
      return VERDADEROS.has(crudo.toLowerCase());
    case 'lista':
      return crudo
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    default:
      throw new Error(`Tipo de variable desconocido para ${nombre}: ${tipo}`);
  }
}

/**
 * @param {string} urlArchivo  import.meta.url del modulo que llama
 * @param {Record<string, {tipo?: 'texto'|'entero'|'decimal'|'booleano'|'lista',
 *         requerida?: boolean, defecto?: any, secreta?: boolean, valores?: string[]}>} esquema
 * @param {{ nombre?: string, salirSiFalta?: boolean }} opciones
 */
export function cargarEnv(urlArchivo, esquema, { nombre, salirSiFalta = true } = {}) {
  const raiz = raizDelPaquete(urlArchivo);
  // quiet: dotenv 17 imprime un consejo por cada carga si no se le pide silencio.
  config({ path: join(raiz, '.env'), quiet: true });

  const etiqueta = nombre ?? raiz.split(/[\\/]/).pop();
  const faltantes = [];
  const errores = [];
  const valores = {};

  for (const [clave, regla] of Object.entries(esquema)) {
    const crudo = process.env[clave];
    const vacio = crudo === undefined || String(crudo).trim() === '';

    if (vacio) {
      if (regla.requerida) faltantes.push(clave);
      valores[clave] = regla.defecto ?? (regla.tipo === 'lista' ? [] : regla.tipo === 'booleano' ? false : '');
      continue;
    }

    const valor = convertir(clave, String(crudo).trim(), regla, errores);
    if (regla.valores && !regla.valores.includes(valor)) {
      errores.push(`${clave} debe ser uno de: ${regla.valores.join(', ')} (llego "${valor}")`);
    }
    valores[clave] = valor;
  }

  valores.NODE_ENV = (process.env.NODE_ENV ?? 'development').trim() || 'development';
  valores.esDesarrollo = valores.NODE_ENV !== 'production';

  if (faltantes.length > 0 || errores.length > 0) {
    const mensaje =
      `\n[${etiqueta}] Configuracion invalida en ${join(raiz, '.env')}:\n` +
      faltantes.map((n) => `  - falta ${n}`).join('\n') +
      (faltantes.length && errores.length ? '\n' : '') +
      errores.map((e) => `  - ${e}`).join('\n') +
      `\n\nCopia ${join(raiz, '.env.example')} a .env y completalo.\n`;

    if (salirSiFalta) {
      console.error(mensaje);
      process.exit(1);
    }
    throw new Error(mensaje);
  }

  return Object.freeze(valores);
}

/**
 * Version imprimible del entorno, con los secretos tapados. Sirve para el log
 * de arranque: ver de un vistazo a que host y puerto apunta cada servicio.
 */
export function resumenEnv(env, esquema) {
  return Object.fromEntries(
    Object.keys(esquema).map((clave) => [
      clave,
      esquema[clave].secreta && env[clave] ? '****' : env[clave],
    ])
  );
}
