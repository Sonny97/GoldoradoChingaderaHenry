/**
 * Almacen en GOOGLE DRIVE: Drive hace de "base de datos" de las imagenes.
 *
 *   GolDorado - Imagenes/          carpeta raiz (appProperties tipo=raiz)
 *     equipo/ jugador/ estadio/    una subcarpeta por entidad, creada al
 *     torneo/ promocion/ usuario/  subir la primera imagen y guardada en cache
 *
 * Cada archivo lleva appProperties { app, entidad, idEntidad, subidoPor }:
 * esa es la "fila". Las busquedas son consultas `q` (consultasDrive.js).
 *
 * INDICE EN MEMORIA: al arrancar se listan (paginado) todas las imagenes de
 * la app y se arma (entidad, idEntidad) -> vigente. Se reconstruye cada 5
 * minutos y se actualiza en cada subida/borrado, asi que BuscarImagenes
 * NUNCA consulta Drive. Si una subida ocurre mientras se reconstruye, el
 * cambio se re-aplica sobre el indice nuevo antes de reemplazar el viejo.
 *
 * CACHE LRU de bytes (~20 MB): una descarga cuesta 200 unidades de cuota.
 *
 * BORRAR = PAPELERA (files.update trashed=true), no files.delete:
 *   - en una unidad compartida, borrar definitivo exige rol Administrador
 *     (organizer); mandar a la papelera basta con Administrador de contenido,
 *     el rol que se recomienda darle a la cuenta de servicio;
 *   - un borrado por error (un admin, un reemplazar con un bug) se recupera
 *     durante 30 dias desde la web de Drive; despues Drive la vacia solo;
 *   - todas las consultas filtran trashed = false, asi que para el servicio
 *     la imagen deja de existir en el acto.
 *   El costo: ocupa espacio hasta 30 dias. Con imagenes de <= 5 MB es poco.
 */

import { Readable } from 'node:stream';
import { aFechaHoraIso } from '@goldorado/comun';

import { conReintentos } from '../utils/backoff.js';
import { crearCacheLru } from '../utils/cacheLru.js';
import { crearIndice } from '../utils/indice.js';
import { desdeBuffer } from '../utils/trozos.js';
import { ENTIDADES } from '../utils/validacion.js';
import { APP, CAMPOS_ARCHIVO, MIME_CARPETA, NOMBRE_RAIZ, consultas } from './consultasDrive.js';
import { traducirErrorDrive } from './erroresDrive.js';

/** Los ids de Drive son [A-Za-z0-9_-]; cualquier otra cosa no se manda a la API. */
const FORMATO_ID = /^[A-Za-z0-9_-]{10,200}$/;
const ESPERA_INDICE_INICIAL_MS = 3000;
const PISTA_REPETIDA_MS = 60_000;

/** files.get/list -> Imagen (o null si no es una imagen de la app). */
export function aImagen(archivo) {
  const props = archivo?.appProperties ?? {};
  if (!archivo?.id || props.app !== APP || archivo.mimeType === MIME_CARPETA) return null;
  if (!ENTIDADES.includes(props.entidad) || !props.idEntidad) return null;
  return {
    id: archivo.id,
    nombre: archivo.name ?? '',
    tipoMime: archivo.mimeType ?? '',
    tamanoBytes: Number(archivo.size ?? 0),
    entidad: props.entidad,
    idEntidad: String(props.idEntidad),
    creadoEn: aFechaHoraIso(archivo.createdTime) ?? '',
    descripcion: archivo.description ?? '',
    subidoPor: Number(props.subidoPor) || 0,
  };
}

/**
 * @param {object} o
 * @param {() => Promise<object>} o.obtenerDrive   crea el cliente drive v3 (inyectable)
 * @param {'oauth'|'cuenta_servicio'} o.autenticacion
 * @param {string} [o.unidadCompartidaId]
 * @param {string} [o.carpetaRaizId]
 * @param {object} o.log
 * @param {number} [o.cacheBytes]
 * @param {number} [o.refrescoMs]
 * @param {(ms: number) => Promise<void>} [o.esperar]  espera del backoff (las pruebas pasan una instantanea)
 */
export function crearAlmacenDrive({
  obtenerDrive,
  autenticacion,
  unidadCompartidaId = '',
  carpetaRaizId = '',
  log,
  cacheBytes = 20 * 1024 * 1024,
  refrescoMs = 5 * 60 * 1000,
  esperar,
}) {
  const cache = crearCacheLru({ maxBytes: cacheBytes });
  const todas = { supportsAllDrives: true }; // inofensivo en "Mi unidad", obligatorio en unidad compartida
  const paramsLista = unidadCompartidaId
    ? { corpora: 'drive', driveId: unidadCompartidaId, includeItemsFromAllDrives: true, supportsAllDrives: true }
    : { corpora: 'user', supportsAllDrives: true };

  let indice = crearIndice();
  let indiceListo = false;
  let refrescoEnCurso = null;
  let cambiosDuranteRefresco = null;
  let primerRefresco = null;
  let temporizador = null;
  let raizId = carpetaRaizId;
  let raizCreacion = null;
  const carpetas = new Map();
  const pistasAvisadas = new Map();

  // --------------------------------------------------------------- utilidades
  let clientePromesa = null;
  function drive() {
    clientePromesa ??= Promise.resolve()
      .then(obtenerDrive)
      .catch((error) => {
        clientePromesa = null; // que la proxima llamada lo vuelva a intentar
        throw error;
      });
    return clientePromesa;
  }

  /** La misma pista no se repite en el log mas de una vez por minuto. */
  function avisar(error) {
    if (!error?.pista) return;
    const ultima = pistasAvisadas.get(error.pista) ?? 0;
    if (Date.now() - ultima < PISTA_REPETIDA_MS) return;
    pistasAvisadas.set(error.pista, Date.now());
    log?.error?.(`Google Drive: ${error.causa?.message ?? error.message}. PISTA: ${error.pista}`);
  }

  /** Llamada a Drive con reintentos (429/403 de cuota/5xx) y errores traducidos. */
  async function llamar(fn, { reintentar = true } = {}) {
    try {
      const cliente = await drive();
      return reintentar ? await conReintentos(() => fn(cliente), { esperar }) : await fn(cliente);
    } catch (error) {
      const traducido = traducirErrorDrive(error, autenticacion);
      avisar(traducido);
      throw traducido;
    }
  }

  async function listarTodo(q, campos = CAMPOS_ARCHIVO) {
    const archivos = [];
    let pageToken;
    do {
      const { data } = await llamar((d) =>
        d.files.list({
          q,
          fields: `nextPageToken, files(${campos})`,
          pageSize: 1000,
          orderBy: 'modifiedTime desc',
          ...(pageToken ? { pageToken } : {}),
          ...paramsLista,
        })
      );
      archivos.push(...(data?.files ?? []));
      pageToken = data?.nextPageToken;
    } while (pageToken);
    return archivos;
  }

  /** Cambio al indice actual y, si hay reconstruccion en curso, tambien al nuevo. */
  function aplicar(cambio) {
    cambio(indice);
    cambiosDuranteRefresco?.push(cambio);
  }

  // ------------------------------------------------------------------ indice
  function refrescar() {
    if (refrescoEnCurso) return refrescoEnCurso;
    cambiosDuranteRefresco = [];
    refrescoEnCurso = (async () => {
      try {
        const nuevo = crearIndice();
        for (const archivo of await listarTodo(consultas.imagenesApp())) {
          const imagen = aImagen(archivo);
          if (imagen) nuevo.agregar(imagen);
        }
        for (const cambio of cambiosDuranteRefresco) cambio(nuevo);
        indice = nuevo;
        indiceListo = true;
        return { imagenes: nuevo.tamano };
      } finally {
        refrescoEnCurso = null;
        cambiosDuranteRefresco = null;
      }
    })();
    return refrescoEnCurso;
  }

  // ----------------------------------------------------------------- carpetas
  async function buscarRaiz() {
    if (raizId) return raizId;
    const { data } = await llamar((d) =>
      d.files.list({ q: consultas.raiz(), fields: 'files(id,name)', pageSize: 10, ...paramsLista })
    );
    if (data?.files?.length) raizId = data.files[0].id;
    return raizId || null;
  }

  /** La raiz, creandola por la API si no existe (con drive.file es la unica forma). */
  function asegurarRaiz() {
    raizCreacion ??= (async () => {
      const existente = await buscarRaiz();
      if (existente) return existente;
      const { data } = await llamar((d) =>
        d.files.create({
          requestBody: {
            name: NOMBRE_RAIZ,
            mimeType: MIME_CARPETA,
            description: 'Imagenes de GolDorado (ms-imagenes). No mover ni renombrar: el servicio la busca por appProperties.',
            appProperties: { app: APP, tipo: 'raiz' },
            ...(unidadCompartidaId ? { parents: [unidadCompartidaId] } : {}),
          },
          fields: 'id,name',
          ...todas,
        })
      );
      raizId = data.id;
      log?.info?.(`Carpeta "${NOMBRE_RAIZ}" creada en Drive: ${raizId} (ponla en DRIVE_CARPETA_RAIZ_ID)`);
      return raizId;
    })().catch((error) => {
      raizCreacion = null;
      throw error;
    });
    return raizCreacion;
  }

  function carpetaDe(entidad) {
    if (!carpetas.has(entidad)) {
      const promesa = (async () => {
        const padre = await asegurarRaiz();
        const { data } = await llamar((d) =>
          d.files.list({ q: consultas.subcarpeta(padre, entidad), fields: 'files(id)', pageSize: 10, ...paramsLista })
        );
        if (data?.files?.length) return data.files[0].id;
        const { data: creada } = await llamar((d) =>
          d.files.create({
            requestBody: {
              name: entidad,
              mimeType: MIME_CARPETA,
              parents: [padre],
              appProperties: { app: APP, tipo: 'carpeta', entidad },
            },
            fields: 'id',
            ...todas,
          })
        );
        return creada.id;
      })();
      promesa.catch(() => carpetas.delete(entidad));
      carpetas.set(entidad, promesa);
    }
    return carpetas.get(entidad);
  }

  /** Descarga que se va guardando para la cache; si se corta, no se guarda. */
  async function* descargar(id, flujo) {
    const partes = [];
    let total = 0;
    let completo = false;
    try {
      for await (const pedazo of flujo) {
        const buf = Buffer.isBuffer(pedazo) ? pedazo : Buffer.from(pedazo);
        total += buf.length;
        if (total <= cacheBytes) partes.push(buf);
        yield buf;
      }
      completo = true;
    } catch (error) {
      const traducido = traducirErrorDrive(error, autenticacion);
      avisar(traducido);
      throw traducido;
    } finally {
      if (completo && total <= cacheBytes) cache.set(id, Buffer.concat(partes, total));
      if (!completo) flujo.destroy?.();
    }
  }

  // ---------------------------------------------------------------- interfaz
  return {
    modo: `drive/${autenticacion}`,
    get descripcion() {
      return raizId ? `${NOMBRE_RAIZ} (${raizId})` : NOMBRE_RAIZ;
    },
    get indiceListo() {
      return indiceListo;
    },

    /** Primer indice + reconstruccion periodica. */
    iniciar() {
      if (!temporizador && refrescoMs > 0) {
        temporizador = setInterval(() => {
          refrescar().catch((error) => log?.aviso?.(`No se pudo refrescar el indice de Drive: ${error.message}`));
        }, refrescoMs);
        temporizador.unref?.();
      }
      primerRefresco = refrescar();
      return primerRefresco;
    },

    refrescar,

    /** db:setup: raiz + las 6 subcarpetas. */
    async preparar() {
      const raiz = await asegurarRaiz();
      for (const entidad of ENTIDADES) await carpetaDe(entidad);
      return { raizId: raiz };
    },

    async guardar({ entidad, idEntidad, nombre, tipoMime, contenido, descripcion, subidoPor }) {
      const carpetaId = await carpetaDe(entidad);
      const { data } = await llamar((d) =>
        d.files.create({
          requestBody: {
            name: nombre,
            mimeType: tipoMime,
            parents: [carpetaId],
            description: descripcion ?? '',
            appProperties: { app: APP, entidad, idEntidad: String(idEntidad), subidoPor: String(Number(subidoPor) || 0) },
          },
          // Un stream NUEVO por intento: un reintento con el stream ya leido subiria 0 bytes.
          media: { mimeType: tipoMime, body: Readable.from(contenido) },
          fields: CAMPOS_ARCHIVO,
          ...todas,
        })
      );
      // Drive puede no devolver appProperties/size en algun caso raro: se completa con lo enviado.
      const imagen = aImagen({
        ...data,
        size: data?.size ?? contenido.length,
        mimeType: data?.mimeType ?? tipoMime,
        createdTime: data?.createdTime ?? new Date().toISOString(),
        appProperties: { app: APP, entidad, idEntidad: String(idEntidad), subidoPor: String(subidoPor ?? 0), ...data?.appProperties },
      });
      if (!imagen) throw new Error(`Drive no devolvio el archivo creado (${JSON.stringify(data)})`);
      aplicar((i) => i.agregar(imagen));
      cache.set(imagen.id, contenido);
      return { ...imagen };
    },

    async metadatos(id) {
      const enIndice = indice.obtener(id);
      if (enIndice) return { ...enIndice };
      if (!FORMATO_ID.test(String(id))) return null;
      try {
        const { data } = await llamar((d) => d.files.get({ fileId: id, fields: CAMPOS_ARCHIVO, ...todas }));
        // Con scope drive la cuenta ve mas archivos que los de la app: solo se sirven los nuestros.
        const imagen = data?.trashed ? null : aImagen(data);
        if (imagen) aplicar((i) => i.agregar(imagen));
        return imagen ? { ...imagen } : null;
      } catch (error) {
        if (error?.estadoHttp === 404) return null;
        throw error;
      }
    },

    /** Bytes de una imagen YA verificada con metadatos(); null si Drive dice 404. */
    async abrir(id) {
      const enCache = cache.get(id);
      if (enCache) return desdeBuffer(enCache);
      if (!FORMATO_ID.test(String(id))) return null;
      try {
        const respuesta = await llamar((d) =>
          d.files.get({ fileId: id, alt: 'media', ...todas }, { responseType: 'stream' })
        );
        const flujo = descargar(id, respuesta.data);
        // Si el cliente cancela antes del primer trozo, el generador nunca
        // arranca y su finally no corre: destroy() cierra la respuesta HTTP igual.
        flujo.destroy = () => respuesta.data?.destroy?.();
        return flujo;
      } catch (error) {
        if (error?.estadoHttp === 404) return null;
        throw error;
      }
    },

    async buscar(entidad, idsEntidad) {
      // Recien arrancado: se espera un momento al primer indice en vez de responder vacio.
      if (!indiceListo && primerRefresco) {
        let temporizadorEspera;
        await Promise.race([
          primerRefresco.catch(() => {}),
          new Promise((r) => {
            temporizadorEspera = setTimeout(r, ESPERA_INDICE_INICIAL_MS);
          }),
        ]);
        clearTimeout(temporizadorEspera);
      }
      return indice.buscar(entidad, idsEntidad).map((i) => ({ ...i }));
    },

    /** Para reemplazar: se pregunta a Drive (fresco) y se une con el indice. */
    async imagenesDe(entidad, idEntidad) {
      const porId = new Map(indice.deEntidad(entidad, idEntidad).map((i) => [i.id, i]));
      for (const archivo of await listarTodo(consultas.imagenesDe(entidad, idEntidad))) {
        const imagen = aImagen(archivo);
        if (imagen) porId.set(imagen.id, imagen);
      }
      return [...porId.values()].map((i) => ({ ...i }));
    },

    async eliminar(id) {
      const imagen = await this.metadatos(id);
      if (!imagen) return false;
      try {
        await llamar((d) =>
          d.files.update({ fileId: id, requestBody: { trashed: true }, fields: 'id,trashed', ...todas })
        );
      } catch (error) {
        if (error?.estadoHttp !== 404) throw error;
      }
      aplicar((i) => i.quitar(id));
      cache.delete(id);
      return true;
    },

    /** Salud: files.get de la carpeta raiz (5 unidades de cuota), sin reintentos. */
    async comprobar() {
      try {
        const raiz = await buscarRaiz();
        if (!raiz) {
          throw new Error(
            `No existe la carpeta "${NOMBRE_RAIZ}" en Drive: corre "npm run db:setup" ` +
              '(la crea por la API e imprime el id para DRIVE_CARPETA_RAIZ_ID)'
          );
        }
        await llamar((d) => d.files.get({ fileId: raiz, fields: 'id', ...todas }), { reintentar: false });
      } catch (error) {
        if (error?.estadoHttp === 404) {
          throw new Error(
            `La carpeta raiz ${raizId} no existe o la app no la ve. ` +
              (autenticacion === 'oauth'
                ? 'Con drive.file solo sirve una carpeta creada por la app ("npm run db:setup").'
                : 'Revisa que este en la unidad compartida DRIVE_UNIDAD_COMPARTIDA_ID.')
          );
        }
        throw new Error(error?.pista ? `${error.message}. ${error.pista}` : error?.message ?? String(error));
      }
    },

    async cerrar() {
      if (temporizador) clearInterval(temporizador);
      temporizador = null;
      await refrescoEnCurso?.catch(() => {});
    },

    get cantidad() {
      return indice.tamano;
    },
    /** Solo para pruebas y diagnostico. */
    get cache() {
      return cache;
    },
  };
}
