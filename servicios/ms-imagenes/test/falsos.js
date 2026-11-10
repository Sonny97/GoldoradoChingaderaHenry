/**
 * Dobles de prueba (sin efectos al importarse: solo exporta funciones).
 *
 * crearDriveFalso imita lo que usa el servicio de la API de Drive v3:
 * files.list / get / create / update / delete, con paginacion y un
 * interprete REAL de la sintaxis `q` que genera consultasDrive.js
 * (appProperties has {...}, mimeType, trashed, 'id' in parents). Si una
 * consulta llega mal escapada, el interprete no la entiende y la prueba
 * falla: asi se prueba el escape de comillas de punta a punta.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

/** Logger que guarda los mensajes en vez de imprimirlos. */
export function crearLogFalso() {
  const mensajes = { info: [], aviso: [], error: [], debug: [] };
  const anotar = (nivel) => (...partes) => mensajes[nivel].push(partes.join(' '));
  return { info: anotar('info'), aviso: anotar('aviso'), error: anotar('error'), debug: anotar('debug'), mensajes };
}

/** Carpeta temporal propia de una prueba + funcion para borrarla. */
export async function carpetaTemporal(prefijo = 'ms-imagenes-') {
  const dir = await mkdtemp(join(tmpdir(), prefijo));
  return { dir, borrar: () => rm(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

/** Bytes con la firma de cada formato + relleno aleatorio-determinista. */
export function bytesDe(tipo, tamano = 256) {
  const cabeceras = {
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    webp: Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]),
  };
  const cabecera = cabeceras[tipo];
  const relleno = Buffer.alloc(Math.max(0, tamano - cabecera.length));
  for (let i = 0; i < relleno.length; i += 1) relleno[i] = (i * 31 + 7) % 251;
  return Buffer.concat([cabecera, relleno]);
}

/** ctx de streaming falso: junta lo que el servicio "escribe". */
export function crearCtxFalso({ cancelarTras = Infinity } = {}) {
  const mensajes = [];
  return {
    mensajes,
    cancelado: () => mensajes.length >= cancelarTras,
    escribir: async (mensaje) => {
      mensajes.push(mensaje);
      return true;
    },
  };
}

/** Error con la forma de GaxiosError de googleapis. */
export function errorHttp(status, reason = '', mensaje = `HTTP ${status} ${reason}`) {
  return Object.assign(new Error(mensaje), {
    status,
    errors: reason ? [{ reason, message: mensaje }] : undefined,
    response: { status, data: { error: { code: status, errors: reason ? [{ reason }] : [] } } },
  });
}

// ------------------------------------------------------------ interprete de q
const desescapar = (s) => s.replace(/\\(.)/g, '$1');
const CADENA = "'((?:\\\\.|[^'\\\\])*)'";
const CLAUSULAS = [
  [new RegExp(`^appProperties has \\{ key=${CADENA} and value=${CADENA} \\}`), (a, m) =>
    a.appProperties?.[desescapar(m[1])] === desescapar(m[2])],
  [new RegExp(`^mimeType (!=|=) ${CADENA}`), (a, m) =>
    m[1] === '=' ? a.mimeType === desescapar(m[2]) : a.mimeType !== desescapar(m[2])],
  [/^trashed = (true|false)/, (a, m) => Boolean(a.trashed) === (m[1] === 'true')],
  [new RegExp(`^${CADENA} in parents`), (a, m) => (a.parents ?? []).includes(desescapar(m[1]))],
];

/** Convierte q en un predicado; lanza si q no tiene la sintaxis esperada. */
export function interpretarQ(q) {
  const filtros = [];
  let resto = String(q);
  for (;;) {
    const regla = CLAUSULAS.find(([re]) => re.test(resto));
    if (!regla) throw new Error(`q no valida para el Drive falso: "${resto}" (en "${q}")`);
    const m = resto.match(regla[0]);
    filtros.push((a) => regla[1](a, m));
    resto = resto.slice(m[0].length);
    if (resto === '') break;
    if (!resto.startsWith(' and ')) throw new Error(`q no valida para el Drive falso: "${resto}" (en "${q}")`);
    resto = resto.slice(5);
  }
  return (archivo) => filtros.every((f) => f(archivo));
}

async function leerTodo(flujo) {
  const partes = [];
  for await (const p of flujo) partes.push(Buffer.from(p));
  return Buffer.concat(partes);
}

/**
 * @param {object} [o]
 * @param {object[]} [o.archivos]   archivos iniciales (con `contenido` Buffer opcional)
 * @param {number} [o.tamanoPagina] para probar la paginacion
 */
export function crearDriveFalso({ archivos = [], tamanoPagina = 100 } = {}) {
  const datos = new Map(archivos.map((a) => [a.id, { trashed: false, ...a }]));
  const llamadas = [];
  const fallas = { list: [], get: [], create: [], update: [], delete: [] };
  let secuencia = 0;

  const publico = ({ contenido, ...resto }) => ({ ...resto });
  function quizasFallar(metodo) {
    const error = fallas[metodo].shift();
    if (error) throw error;
  }
  function buscar(id) {
    const archivo = datos.get(id);
    if (!archivo) throw errorHttp(404, 'notFound', `File not found: ${id}`);
    return archivo;
  }

  const files = {
    async list(params) {
      llamadas.push({ metodo: 'list', params });
      quizasFallar('list');
      const cumple = interpretarQ(params.q);
      const todos = [...datos.values()]
        .filter(cumple)
        .sort((a, b) => String(b.modifiedTime ?? '').localeCompare(String(a.modifiedTime ?? '')));
      const inicio = Number(params.pageToken ?? 0);
      const fin = inicio + Math.min(params.pageSize ?? 100, tamanoPagina);
      return {
        data: { files: todos.slice(inicio, fin).map(publico), ...(fin < todos.length ? { nextPageToken: String(fin) } : {}) },
      };
    },
    async get(params, opciones) {
      llamadas.push({ metodo: 'get', params, opciones });
      quizasFallar('get');
      const archivo = buscar(params.fileId);
      if (params.alt === 'media') {
        const bytes = archivo.contenido ?? Buffer.alloc(0);
        const pedazos = [];
        for (let i = 0; i < bytes.length; i += 10_000) pedazos.push(bytes.subarray(i, i + 10_000));
        return { data: Readable.from(pedazos) };
      }
      return { data: publico(archivo) };
    },
    async create(params) {
      llamadas.push({ metodo: 'create', params });
      quizasFallar('create');
      const contenido = params.media ? await leerTodo(params.media.body) : undefined;
      secuencia += 1;
      const fecha = new Date(Date.UTC(2026, 10, 10, 12, 0, secuencia)).toISOString();
      const archivo = {
        id: `falso-${String(secuencia).padStart(8, '0')}`,
        name: params.requestBody.name,
        mimeType: params.requestBody.mimeType,
        description: params.requestBody.description,
        appProperties: { ...params.requestBody.appProperties },
        parents: params.requestBody.parents ?? ['root'],
        trashed: false,
        createdTime: fecha,
        modifiedTime: fecha,
        ...(contenido ? { size: String(contenido.length), contenido } : {}),
      };
      datos.set(archivo.id, archivo);
      return { data: publico(archivo) };
    },
    async update(params) {
      llamadas.push({ metodo: 'update', params });
      quizasFallar('update');
      const archivo = buscar(params.fileId);
      Object.assign(archivo, params.requestBody);
      return { data: { id: archivo.id, trashed: archivo.trashed } };
    },
    async delete(params) {
      llamadas.push({ metodo: 'delete', params });
      quizasFallar('delete');
      buscar(params.fileId);
      datos.delete(params.fileId);
      return { status: 204, data: '' };
    },
  };

  return {
    files,
    llamadas,
    fallas,
    datos,
    /** Llamadas de un metodo (opcionalmente filtradas). */
    de: (metodo, filtro = () => true) => llamadas.filter((l) => l.metodo === metodo && filtro(l.params)),
  };
}
