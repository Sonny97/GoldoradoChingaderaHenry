/**
 * Rutas de autenticacion y perfil: /api/auth/*  (ms-autenticacion, SQL Server).
 *
 * Igual que en el monolito, la ruta solo traduce HTTP: lee el body, llama al
 * microservicio y elige el codigo de estado. Las reglas (clave, documento
 * repetido, mayoria de edad) viven en ms-autenticacion; los errores llegan como
 * estado gRPC y el manejador central los convierte en 400/401/409 con el mismo
 * mensaje que mostraba el monolito.
 *
 * Lo que SI hace el BFF: armar el `User` con el saldo (ms-apuestas) y la foto
 * (ms-imagenes), crear la billetera de las cuentas nuevas, y pasarle a
 * ms-autenticacion la IP y el navegador para su tabla Sesion.
 */

import { Router } from 'express';

import { aProveedor } from '../mapeadores/usuario.js';
import { urlImagen } from '../mapeadores/imagenes.js';
import { crearArmadorUsuario } from '../agregadores/usuario.js';
import { ErrorHttp, enviarOk } from '../utils/apiResult.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { contextoCliente, opciones, texto, textoOpcional, tokenDeCabecera } from '../utils/contexto.js';
import { PLAZOS } from '../clientes.js';
import { crearSubida, TIPOS_FOTO, validarArchivo } from '../utils/subida.js';

const ACEPTADO = new Set([true, 'true', 1, '1', 'on']);
const MENSAJE_TERMINOS = 'Debes aceptar los términos y condiciones';

function exigirTerminos(body) {
  if (!ACEPTADO.has(body?.terms)) {
    throw new ErrorHttp(400, MENSAJE_TERMINOS, { campos: { terms: MENSAJE_TERMINOS } });
  }
}

/** Ficha de cliente del body (registro y completar perfil usan los mismos nombres). */
function fichaDe(body) {
  return {
    nombres: texto(body.name).trim(),
    apellidos: texto(body.lastname).trim(),
    tipoDocumento: texto(body.documentType).trim(),
    numeroDocumento: texto(body.documentNumber).trim(),
    telefono: texto(body.phone).trim(),
    fechaNacimiento: texto(body.birthDate).trim(),
  };
}

export function crearRutasAuth({ clientes, log, guardas, limites }) {
  const router = Router();
  const usuarios = crearArmadorUsuario({ clientes, log });
  const subida = crearSubida();
  const { autenticar } = guardas;
  const auth = clientes.autenticacion;

  /* --------------------------------------------------------------- sesion */

  router.post(
    '/login',
    limites.limiteAcceso,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const sesion = await auth.IniciarSesion(
        {
          identificador: texto(body.username).trim(),
          password: texto(body.password),
          contexto: contextoCliente(req),
        },
        opciones(req)
      );
      const user = await usuarios.armar(sesion.usuario, req);
      enviarOk(res, { user, token: sesion.token }, 'Bienvenido de nuevo');
    })
  );

  router.post(
    '/register',
    limites.limiteAcceso,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      exigirTerminos(body);
      const sesion = await auth.Registrar(
        {
          email: texto(body.email).trim(),
          password: texto(body.password),
          ...fichaDe(body),
          contexto: contextoCliente(req),
        },
        opciones(req)
      );
      const billetera = await usuarios.asegurarBilletera(Number(sesion.usuario.id), req);
      const user = await usuarios.armar(sesion.usuario, req, { billetera: billetera ?? undefined, avatarUrl: null });
      enviarOk(res, { user, token: sesion.token }, 'Cuenta creada correctamente', 201);
    })
  );

  /**
   * Cierre de sesion. A diferencia del monolito (JWT sin estado: no habia nada
   * que invalidar), aqui SI se revoca la sesion en la tabla Sesion, y el token
   * deja de servir aunque alguien lo haya copiado. Responde 200 siempre: el
   * usuario quiere salir, y un error de red no debe dejarlo "atrapado".
   */
  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token = tokenDeCabecera(req);
      if (token) {
        try {
          await auth.CerrarSesion({ token, contexto: contextoCliente(req) }, opciones(req));
        } catch (error) {
          log.aviso(`CerrarSesion fallo (se responde 200 igual): ${error?.details ?? error?.message}`);
        }
      }
      enviarOk(res, null, 'Sesión cerrada');
    })
  );

  router.post(
    '/logout-todos',
    autenticar,
    asyncHandler(async (req, res) => {
      const r = await auth.CerrarTodasLasSesiones({ idUsuario: req.usuario.idUsuario }, opciones(req));
      enviarOk(res, { closed: Number(r.sesionesCerradas ?? 0) }, 'Cerraste sesión en todos tus dispositivos');
    })
  );

  /* --------------------------------------------------------------- perfil */

  router.get(
    '/me',
    autenticar,
    asyncHandler(async (req, res) => {
      enviarOk(res, await usuarios.porId(req.usuario.idUsuario, req));
    })
  );

  router.patch(
    '/perfil',
    autenticar,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      // Solo viaja lo que vino: un `optional` ausente es "no lo cambies".
      const usuario = await auth.ActualizarPerfil(
        {
          idUsuario: req.usuario.idUsuario,
          nombres: textoOpcional(body.name)?.trim(),
          apellidos: textoOpcional(body.lastname)?.trim(),
          telefono: textoOpcional(body.phone)?.trim(),
        },
        opciones(req)
      );
      enviarOk(res, await usuarios.armar(usuario, req), 'Perfil actualizado');
    })
  );

  router.post(
    '/completar-perfil',
    autenticar,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      exigirTerminos(body);
      const usuario = await auth.CompletarPerfil(
        { idUsuario: req.usuario.idUsuario, ...fichaDe(body) },
        opciones(req)
      );
      const billetera = await usuarios.asegurarBilletera(req.usuario.idUsuario, req);
      enviarOk(res, await usuarios.armar(usuario, req, { billetera: billetera ?? undefined }), 'Perfil completado');
    })
  );

  /** Foto de perfil: una imagen de ms-imagenes con entidad 'usuario' e id = el del token. */
  router.post(
    '/avatar',
    autenticar,
    subida.single('imagen'),
    asyncHandler(async (req, res) => {
      const archivo = validarArchivo(req.file, TIPOS_FOTO);
      const idUsuario = req.usuario.idUsuario;
      const imagen = await clientes.imagenes.SubirImagen(
        {
          entidad: 'usuario',
          idEntidad: String(idUsuario),
          nombre: archivo.originalname || 'avatar',
          tipoMime: archivo.mimetype,
          contenido: archivo.buffer,
          reemplazar: true,
          subidoPor: idUsuario,
        },
        opciones(req, { plazoMs: PLAZOS.subida })
      );
      enviarOk(res, await usuarios.porId(idUsuario, req, { avatarUrl: urlImagen(imagen.id) }), 'Foto de perfil actualizada');
    })
  );

  router.delete(
    '/avatar',
    autenticar,
    asyncHandler(async (req, res) => {
      const idUsuario = req.usuario.idUsuario;
      const { imagenes = [] } = await clientes.imagenes.BuscarImagenes(
        { entidad: 'usuario', idsEntidad: [String(idUsuario)] },
        opciones(req)
      );
      for (const imagen of imagenes) {
        await clientes.imagenes.EliminarImagen({ id: imagen.id }, opciones(req));
      }
      enviarOk(res, await usuarios.porId(idUsuario, req, { avatarUrl: null }), 'Foto de perfil eliminada');
    })
  );

  router.get(
    '/proveedores',
    asyncHandler(async (req, res) => {
      const { proveedores = [] } = await auth.ListarProveedores({}, opciones(req));
      enviarOk(res, proveedores.map(aProveedor));
    })
  );

  /* -------------------------------------------------- recuperacion de clave */

  router.post(
    '/recuperar/buscar',
    asyncHandler(async (req, res) => {
      const r = await auth.BuscarCuenta({ identificador: texto(req.body?.username).trim() }, opciones(req));
      enviarOk(res, {
        userId: Number(r.idUsuario),
        emailMasked: r.emailEnmascarado,
        phoneMasked: r.telefonoEnmascarado,
        hasEmail: Boolean(r.tieneEmail),
        hasSms: Boolean(r.tieneSms),
      });
    })
  );

  router.post(
    '/recuperar/solicitar',
    limites.limiteAcceso,
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const metodo = body.method === 'sms' ? 'sms' : 'email';
      const r = await auth.SolicitarCodigo(
        { identificador: texto(body.username).trim(), metodo, contexto: contextoCliente(req) },
        opciones(req)
      );
      const data = {
        token: r.token,
        method: r.metodo,
        destinationMasked: r.destinoEnmascarado,
        expiresAt: Number(r.expiraEnMs),
      };
      // Solo en desarrollo: en produccion ms-autenticacion no lo manda y la
      // clave no aparece en el JSON (igual que en el monolito).
      if (r.codigoDev) data.devCode = r.codigoDev;
      enviarOk(
        res,
        data,
        r.metodo === 'sms' ? 'Te enviamos un código por mensaje de texto' : 'Te enviamos un código a tu correo'
      );
    })
  );

  router.post(
    '/recuperar/verificar',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const r = await auth.VerificarCodigo(
        { token: texto(body.token).trim(), codigo: texto(body.code).trim() },
        opciones(req)
      );
      enviarOk(res, { resetToken: r.resetToken }, 'Código verificado');
    })
  );

  router.post(
    '/recuperar/restablecer',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const r = await auth.RestablecerPassword(
        { resetToken: texto(body.resetToken).trim(), password: texto(body.password), contexto: contextoCliente(req) },
        opciones(req)
      );
      enviarOk(res, { email: r.email }, 'Tu contraseña fue actualizada');
    })
  );

  return router;
}
