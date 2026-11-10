/**
 * Almacen de Drive con un cliente FALSO inyectado (sin red): construccion
 * del indice paginado, consultas `q` con escape, carpetas en cache,
 * cache de bytes, borrado a la papelera y traduccion de errores.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';

import { crearAlmacenDrive } from '../src/almacenes/drive.js';
import { consultas, escaparQ, MIME_CARPETA } from '../src/almacenes/consultasDrive.js';
import { crearServicioImagenes } from '../src/servicios/imagenServicio.js';
import { bytesDe, crearCtxFalso, crearDriveFalso, crearLogFalso, errorHttp } from './falsos.js';

const Q_TODAS =
  "appProperties has { key='app' and value='goldorado' } and mimeType != 'application/vnd.google-apps.folder' and trashed = false";

function imagenDrive(id, entidad, idEntidad, fecha, extra = {}) {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    size: '4',
    createdTime: fecha,
    modifiedTime: fecha,
    appProperties: { app: 'goldorado', entidad, idEntidad, subidoPor: '0' },
    parents: ['carpeta-equipo-01'],
    contenido: bytesDe('png', 4096),
    ...extra,
  };
}

function armar({ archivos = [], tamanoPagina = 100, ...opciones } = {}) {
  const drive = crearDriveFalso({ archivos, tamanoPagina });
  const log = crearLogFalso();
  const esperas = [];
  const almacen = crearAlmacenDrive({
    obtenerDrive: async () => drive,
    autenticacion: 'oauth',
    log,
    refrescoMs: 0,
    esperar: async (ms) => esperas.push(ms),
    ...opciones,
  });
  const imagenes = crearServicioImagenes({ almacen, log });
  return { drive, log, almacen, imagenes, esperas };
}

const conCodigo = (codigo, mensaje) => (error) => {
  assert.equal(error.codigo, codigo, error.message);
  if (mensaje) assert.equal(error.message, mensaje);
  return true;
};

test('indice: lista paginada, solo imagenes de la app, la mas reciente por entidad', async () => {
  const { drive, almacen } = armar({
    tamanoPagina: 2,
    archivos: [
      imagenDrive('img-equipo-1-vieja', 'equipo', '1', '2026-01-01T00:00:00.000Z'),
      imagenDrive('img-equipo-1-nueva', 'equipo', '1', '2026-03-01T00:00:00.000Z'),
      imagenDrive('img-equipo-2-unica', 'equipo', '2', '2026-02-01T00:00:00.000Z'),
      imagenDrive('img-usuario-7-foto', 'usuario', '7', '2026-02-01T00:00:00.000Z'),
      imagenDrive('img-en-la-papelera', 'equipo', '3', '2026-04-01T00:00:00.000Z', { trashed: true }),
      imagenDrive('img-de-otra-app-xx', 'equipo', '4', '2026-04-01T00:00:00.000Z', { appProperties: { app: 'otra', entidad: 'equipo', idEntidad: '4' } }),
      { id: 'carpeta-equipo-01', name: 'equipo', mimeType: MIME_CARPETA, appProperties: { app: 'goldorado', tipo: 'carpeta', entidad: 'equipo' } },
    ],
  });

  assert.deepEqual(await almacen.iniciar(), { imagenes: 4 });
  const listas = drive.de('list');
  assert.equal(listas.length, 2, '4 resultados en paginas de 2 = 2 llamadas');
  assert.equal(listas[0].params.q, Q_TODAS);
  assert.equal(listas[0].params.orderBy, 'modifiedTime desc');
  assert.match(listas[0].params.fields, /^nextPageToken, files\(/);
  assert.equal(listas[1].params.pageToken, '2');

  const vigentes = await almacen.buscar('equipo', ['1', '2', '3', '4']);
  assert.deepEqual(vigentes.map((i) => i.id), ['img-equipo-1-nueva', 'img-equipo-2-unica']);
  assert.deepEqual((await almacen.buscar('equipo', [])).map((i) => i.idEntidad).sort(), ['1', '2']);

  // BuscarImagenes NUNCA consulta Drive: sale del indice.
  const antes = drive.llamadas.length;
  await almacen.buscar('usuario', ['7']);
  assert.equal(drive.llamadas.length, antes);
});

test('q: comillas y barras invertidas se escapan (sin inyeccion)', async () => {
  assert.equal(escaparQ("O'Brien\\"), "O\\'Brien\\\\");
  const malicioso = "7' or name contains '";
  const q = consultas.imagenesDe('usuario', malicioso);
  assert.ok(q.includes("value='7\\' or name contains \\''"), q);

  const { drive, almacen } = armar({
    archivos: [
      imagenDrive('img-usuario-7-foto', 'usuario', '7', '2026-02-01T00:00:00.000Z'),
      imagenDrive('img-usuario-raro-x', 'usuario', malicioso, '2026-02-02T00:00:00.000Z'),
    ],
  });
  // El Drive falso interpreta q de verdad: el valor raro se busca LITERAL.
  assert.deepEqual((await almacen.imagenesDe('usuario', malicioso)).map((i) => i.id), ['img-usuario-raro-x']);
  assert.equal(drive.de('list')[0].params.q, q);
});

test('guardar: raiz y subcarpeta por la API (una sola vez), appProperties completas', async () => {
  const { drive, almacen, imagenes } = armar();
  await almacen.iniciar();
  const contenido = bytesDe('png', 3000);
  const img = await imagenes.subir({ entidad: 'equipo', idEntidad: '5', nombre: 'boca.png', tipoMime: 'image/png', contenido, subidoPor: 9 });
  await imagenes.subir({ entidad: 'equipo', idEntidad: '6', tipoMime: 'image/png', contenido });

  const creadas = drive.de('create');
  const carpetas = creadas.filter((c) => c.params.requestBody.mimeType === MIME_CARPETA);
  assert.equal(carpetas.length, 2, 'raiz + equipo, cada una una sola vez');
  assert.deepEqual(carpetas[0].params.requestBody.appProperties, { app: 'goldorado', tipo: 'raiz' });
  assert.equal(carpetas[0].params.requestBody.name, 'GolDorado - Imagenes');
  assert.deepEqual(carpetas[1].params.requestBody.appProperties, { app: 'goldorado', tipo: 'carpeta', entidad: 'equipo' });

  const archivo = creadas.find((c) => c.params.requestBody.name === 'boca.png').params;
  assert.deepEqual(archivo.requestBody.appProperties, { app: 'goldorado', entidad: 'equipo', idEntidad: '5', subidoPor: '9' });
  assert.deepEqual(archivo.requestBody.parents, [drive.datos.get(img.id).parents[0]]);
  assert.equal(archivo.supportsAllDrives, true);
  assert.match(archivo.requestBody.description, /equipo 5/);
  for (const [clave, valor] of Object.entries(archivo.requestBody.appProperties)) {
    assert.ok(Buffer.byteLength(clave + valor) <= 124, 'limite de 124 bytes por propiedad');
  }

  // Indice al dia sin volver a listar, y bytes servidos desde la cache LRU.
  assert.equal((await almacen.buscar('equipo', ['5']))[0].id, img.id);
  const ctx = crearCtxFalso();
  await imagenes.transmitir(img.id, ctx);
  assert.ok(Buffer.concat(ctx.mensajes.slice(1).map((m) => m.trozo)).equals(contenido));
  assert.equal(drive.de('get', (p) => p.alt === 'media').length, 0, 'recien subida: sale de la cache');
});

test('abrir: descarga alt=media en stream, la guarda en cache y la segunda vez no descarga', async () => {
  const archivo = imagenDrive('img-equipo-1-nueva', 'equipo', '1', '2026-03-01T00:00:00.000Z', { contenido: bytesDe('png', 150_000) });
  const { drive, almacen, imagenes } = armar({ archivos: [archivo] });
  await almacen.iniciar();

  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    const ctx = crearCtxFalso();
    await imagenes.transmitir('img-equipo-1-nueva', ctx);
    assert.equal(ctx.mensajes[0].metadatos.id, 'img-equipo-1-nueva');
    assert.deepEqual(ctx.mensajes.slice(1).map((m) => m.trozo.length), [65536, 65536, 150_000 - 131072]);
    assert.ok(Buffer.concat(ctx.mensajes.slice(1).map((m) => m.trozo)).equals(archivo.contenido));
  }
  const descargas = drive.de('get', (p) => p.alt === 'media');
  assert.equal(descargas.length, 1);
  assert.deepEqual(descargas[0].opciones, { responseType: 'stream' });
});

test('metadatos de un id que no esta en el indice: files.get, y solo si es de la app', async () => {
  const { drive, imagenes } = armar({
    archivos: [
      imagenDrive('img-llego-por-otro-lado', 'jugador', '3', '2026-03-01T00:00:00.000Z'),
      imagenDrive('img-de-otra-app-xx', 'equipo', '4', '2026-04-01T00:00:00.000Z', { appProperties: { app: 'otra' } }),
    ],
  });
  assert.equal((await imagenes.metadatos('img-llego-por-otro-lado')).idEntidad, '3');
  await assert.rejects(imagenes.metadatos('img-de-otra-app-xx'), conCodigo(CODIGOS.NOT_FOUND, 'Imagen no encontrada'));
  await assert.rejects(imagenes.metadatos('no-existe-en-drive'), conCodigo(CODIGOS.NOT_FOUND, 'Imagen no encontrada'));
  await assert.rejects(imagenes.metadatos("x' or '1'='1"), conCodigo(CODIGOS.NOT_FOUND));
  assert.equal(drive.de('get', (p) => p.fileId.includes("'")).length, 0, 'un id con comillas ni llega a Drive');
});

test('reemplazar y eliminar: la anterior va a la PAPELERA, despues de subir la nueva', async () => {
  const { drive, almacen, imagenes } = armar({
    archivos: [imagenDrive('img-usuario-7-foto', 'usuario', '7', '2026-02-01T00:00:00.000Z')],
  });
  await almacen.iniciar();
  const nueva = await imagenes.subir({ entidad: 'usuario', idEntidad: '7', tipoMime: 'image/jpeg', contenido: bytesDe('jpeg'), reemplazar: true });

  const orden = drive.llamadas.map((l) => l.metodo);
  assert.ok(orden.lastIndexOf('create') < orden.indexOf('update'), 'primero se sube, luego se borra la vieja');
  const papelera = drive.de('update')[0].params;
  assert.equal(papelera.fileId, 'img-usuario-7-foto');
  assert.deepEqual(papelera.requestBody, { trashed: true });
  assert.equal(drive.de('delete').length, 0, 'no se borra definitivo');
  assert.deepEqual((await almacen.buscar('usuario', ['7'])).map((i) => i.id), [nueva.id]);

  await imagenes.eliminar(nueva.id);
  assert.deepEqual(await almacen.buscar('usuario', ['7']), []);
  await assert.rejects(imagenes.eliminar(nueva.id), conCodigo(CODIGOS.NOT_FOUND));
});

test('unidad compartida: corpora drive + driveId, y la raiz se crea dentro de la unidad', async () => {
  const { drive, almacen } = armar({ autenticacion: 'cuenta_servicio', unidadCompartidaId: '0AunidadFalsa' });
  await almacen.iniciar();
  await almacen.preparar();
  const lista = drive.de('list')[0].params;
  assert.equal(lista.corpora, 'drive');
  assert.equal(lista.driveId, '0AunidadFalsa');
  assert.equal(lista.includeItemsFromAllDrives, true);
  assert.equal(lista.supportsAllDrives, true);
  const raiz = drive.de('create')[0].params.requestBody;
  assert.deepEqual(raiz.parents, ['0AunidadFalsa']);
  assert.equal(drive.de('create').length, 7, 'raiz + 6 subcarpetas');
  assert.equal(almacen.modo, 'drive/cuenta_servicio');
});

test('errores: cuota de cuenta de servicio, credenciales, red y limites', async () => {
  // 403 storageQuotaExceeded -> UNAVAILABLE + pista en el log
  const a = armar({ autenticacion: 'cuenta_servicio', carpetaRaizId: 'raiz-configurada-01' });
  a.drive.fallas.create.push(errorHttp(403, 'storageQuotaExceeded', 'Service Accounts do not have storage quota.'));
  await assert.rejects(
    a.imagenes.subir({ entidad: 'equipo', idEntidad: '1', tipoMime: 'image/png', contenido: bytesDe('png') }),
    conCodigo(CODIGOS.UNAVAILABLE, 'El almacén de imágenes no tiene espacio disponible')
  );
  assert.ok(a.log.mensajes.error.some((m) => /PISTA: .*unidad compartida/.test(m)), a.log.mensajes.error.join('\n'));

  // 401 / invalid_grant -> UNAVAILABLE + pista del refresh token
  const b = armar();
  b.drive.fallas.list.push(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } }));
  await assert.rejects(b.almacen.iniciar(), conCodigo(CODIGOS.UNAVAILABLE));
  assert.ok(b.log.mensajes.error.some((m) => /obtener-refresh-token/.test(m)));
  b.drive.fallas.list.push(errorHttp(401, 'authError'));
  await assert.rejects(b.almacen.refrescar(), conCodigo(CODIGOS.UNAVAILABLE));

  // red (DNS) -> UNAVAILABLE
  const c = armar();
  c.drive.fallas.get.push(Object.assign(new Error('getaddrinfo ENOTFOUND www.googleapis.com'), { code: 'ENOTFOUND' }));
  await assert.rejects(c.imagenes.metadatos('id-que-no-esta-en-indice'), conCodigo(CODIGOS.UNAVAILABLE, 'No hay conexión con Google Drive'));

  // 403 de permisos (drive.file) -> UNAVAILABLE con la pista de drive.file
  const d = armar({ carpetaRaizId: 'carpeta-hecha-a-mano' });
  d.drive.fallas.list.push(errorHttp(403, 'insufficientFilePermissions'));
  await assert.rejects(
    d.imagenes.subir({ entidad: 'torneo', idEntidad: '1', tipoMime: 'image/png', contenido: bytesDe('png') }),
    conCodigo(CODIGOS.UNAVAILABLE)
  );
  assert.ok(d.log.mensajes.error.some((m) => /drive\.file/.test(m)));

  // 429 y 403 rateLimitExceeded se reintentan con espera exponencial y la subida termina bien
  const e = armar();
  e.drive.fallas.create.push(errorHttp(429, 'rateLimitExceeded'), errorHttp(403, 'userRateLimitExceeded'));
  const img = await e.imagenes.subir({ entidad: 'estadio', idEntidad: '2', tipoMime: 'image/png', contenido: bytesDe('png', 999) });
  assert.equal(e.esperas.length, 2);
  assert.equal(e.drive.datos.get(img.id).contenido.length, 999, 'el reintento sube los bytes completos (stream nuevo)');
});

test('comprobar (Salud): ok con raiz, mensajes con pista cuando falla', async () => {
  const ok = armar({ archivos: [{ id: 'raiz-de-prueba-01', name: 'GolDorado - Imagenes', mimeType: MIME_CARPETA, appProperties: { app: 'goldorado', tipo: 'raiz' } }] });
  await ok.almacen.comprobar();
  assert.equal(ok.almacen.descripcion, 'GolDorado - Imagenes (raiz-de-prueba-01)');
  assert.deepEqual(ok.drive.de('get')[0].params, { fileId: 'raiz-de-prueba-01', fields: 'id', supportsAllDrives: true });

  const sinRaiz = armar();
  await assert.rejects(sinRaiz.almacen.comprobar(), /npm run db:setup/);

  const raizBorrada = armar({ carpetaRaizId: 'raiz-que-no-existe' });
  await assert.rejects(raizBorrada.almacen.comprobar(), /no existe o la app no la ve.*drive\.file/);

  const sinLlave = armar({
    autenticacion: 'cuenta_servicio',
    unidadCompartidaId: '0Aunidad',
    obtenerDrive: async () => {
      throw Object.assign(new Error('No se pudo leer la llave'), { code: 'CREDENCIALES', pista: 'Descarga la llave JSON' });
    },
  });
  await assert.rejects(sinLlave.almacen.comprobar(), /credenciales de Google Drive.*Descarga la llave JSON/);
});
