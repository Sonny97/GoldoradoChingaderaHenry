/**
 * Imagenes: /api/imagenes/*  (ms-imagenes, Google Drive).
 *
 * GET /api/imagenes/:id es un PUENTE de streaming: ms-imagenes manda primero
 * un mensaje con los metadatos (tipo, tamaño) y despues los bytes en trozos;
 * el BFF escribe las cabeceras HTTP al llegar los metadatos y va pasando cada
 * trozo a la respuesta sin juntar el archivo en memoria. Si el navegador no da
 * abasto (backpressure) se pausa el stream gRPC; si el navegador se va, se
 * cancela la llamada para que ms-imagenes deje de leer de Drive.
 *
 * Cabeceras de seguridad: una imagen subida por un admin podria ser un SVG con
 * <script>. nosniff + una CSP sin nada permitido + sandbox hacen que, aunque se
 * abra la URL directamente, el navegador no ejecute nada.
 */

import { CODIGOS } from '@goldorado/comun';
import { Router } from 'express';

import { PLAZOS } from '../clientes.js';
import { requiereRol } from '../middleware/autenticar.js';
import { aImage } from '../mapeadores/imagenes.js';
import { ErrorHttp, enviarError, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { opciones, texto } from '../utils/contexto.js';
import { crearSubida, TIPOS_ADMIN, validarArchivo } from '../utils/subida.js';

export const ENTIDADES = Object.freeze(['equipo', 'jugador', 'estadio', 'torneo', 'promocion', 'usuario']);
const ID_VALIDO = /^[A-Za-z0-9_-]{1,200}$/;

export const CABECERAS_IMAGEN = Object.freeze({
  'Cache-Control': 'public, max-age=86400, immutable',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
});

export function crearRutasImagenes({ clientes, log, guardas }) {
  const router = Router();
  const subida = crearSubida();
  const soloAdmin = [guardas.autenticar, requiereRol('admin')];

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const entidad = texto(req.query.entidad).trim().toLowerCase();
      if (!ENTIDADES.includes(entidad)) {
        throw new ErrorHttp(400, `Entidad inválida. Usa una de: ${ENTIDADES.join(', ')}`);
      }
      const ids = texto(req.query.ids)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);
      const { imagenes = [] } = await clientes.imagenes.BuscarImagenes({ entidad, idsEntidad: ids }, opciones(req));
      enviarOk(res, imagenes.map(aImage));
    })
  );

  router.get('/:id', (req, res, next) => {
    const id = String(req.params.id);
    if (!ID_VALIDO.test(id)) return enviarError(res, 'Imagen no encontrada', 404);

    const llamada = clientes.imagenes.ObtenerImagen({ id }, opciones(req, { plazoMs: PLAZOS.descarga }));
    let cabeceras = false;
    let terminado = false;

    // El navegador cerro la pestaña o cancelo la descarga: no tiene sentido
    // seguir bajando de Drive.
    res.on('close', () => {
      if (!terminado) {
        terminado = true;
        llamada.cancel();
      }
    });

    llamada.on('data', (fragmento) => {
      if (fragmento.metadatos) {
        if (cabeceras) return;
        const m = fragmento.metadatos;
        res.status(200);
        res.setHeader('Content-Type', m.tipoMime || 'application/octet-stream');
        const tamano = Number(m.tamanoBytes ?? 0);
        if (tamano > 0) res.setHeader('Content-Length', String(tamano));
        for (const [nombre, valor] of Object.entries(CABECERAS_IMAGEN)) res.setHeader(nombre, valor);
        cabeceras = true;
        return;
      }
      if (!fragmento.trozo) return;
      if (!cabeceras) {
        // Protocolo roto: llegaron bytes sin metadatos. Mejor un error que una
        // imagen sin Content-Type.
        terminado = true;
        llamada.cancel();
        next(new ErrorHttp(502, 'La imagen llegó incompleta'));
        return;
      }
      if (!res.write(fragmento.trozo)) {
        llamada.pause();
        res.once('drain', () => llamada.resume());
      }
    });

    llamada.on('end', () => {
      if (terminado) return;
      terminado = true;
      if (!cabeceras) {
        next(new ErrorHttp(502, 'La imagen llegó incompleta'));
        return;
      }
      res.end();
    });

    llamada.on('error', (error) => {
      if (error?.code === CODIGOS.CANCELLED && (terminado || res.destroyed)) return;
      terminado = true;
      if (!cabeceras && !res.headersSent) {
        next(error);
        return;
      }
      // Ya salieron cabeceras: no hay forma de avisar con JSON. Se corta la
      // conexion para que el navegador no guarde media imagen como si fuera buena.
      log.aviso(`ObtenerImagen(${id}) fallo a mitad del envio: ${error?.details ?? error?.message}`);
      res.destroy(error);
    });

    return undefined;
  });

  router.post(
    '/',
    ...soloAdmin,
    subida.single('imagen'),
    asyncHandler(async (req, res) => {
      const archivo = validarArchivo(req.file, TIPOS_ADMIN);
      const body = req.body ?? {};
      const entidad = texto(body.entidad).trim().toLowerCase();
      if (!ENTIDADES.includes(entidad)) {
        throw new ErrorHttp(400, `Entidad inválida. Usa una de: ${ENTIDADES.join(', ')}`);
      }
      const idEntidad = texto(body.idEntidad).trim();
      if (!idEntidad) throw new ErrorHttp(400, 'Indica a qué registro pertenece la imagen (idEntidad)');
      const descripcion = texto(body.descripcion).trim();

      const imagen = await clientes.imagenes.SubirImagen(
        {
          entidad,
          idEntidad,
          nombre: archivo.originalname || `${entidad}-${idEntidad}`,
          tipoMime: archivo.mimetype,
          contenido: archivo.buffer,
          descripcion: descripcion || undefined,
          reemplazar: ['true', '1', 'on'].includes(texto(body.reemplazar).toLowerCase()),
          subidoPor: req.usuario.idUsuario,
        },
        opciones(req, { plazoMs: PLAZOS.subida })
      );
      enviarOk(res, aImage(imagen), 'Imagen subida', 201);
    })
  );

  router.delete(
    '/:id',
    ...soloAdmin,
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      if (!ID_VALIDO.test(id)) throw new ErrorHttp(404, 'Imagen no encontrada');
      await clientes.imagenes.EliminarImagen({ id }, opciones(req));
      enviarOk(res, null, 'Imagen eliminada');
    })
  );

  return router;
}
