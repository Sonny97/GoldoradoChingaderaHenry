/**
 * Implementacion de cada RPC de autenticacion.proto: TRADUCE request <->
 * servicios, no decide nada (igual que las rutas del monolito traducian HTTP).
 *
 * Los metodos se llaman como en el .proto (PascalCase) y los campos llegan en
 * camelCase (keepCase:false). Un error se LANZA desde el servicio y
 * crearServidorGrpc() lo convierte en estado gRPC; aqui no hay try/catch.
 */

/** ContextoCliente lo rellena el BFF; si no llego (mensaje no enviado) es null. */
const contextoDe = (request) => ({
  ip: request.contexto?.ip || '',
  userAgent: request.contexto?.userAgent || '',
});

/** Campos de la ficha de Cliente, comunes a Registrar y CompletarPerfil. */
const fichaDe = (request) => ({
  nombres: request.nombres,
  apellidos: request.apellidos,
  tipoDocumento: request.tipoDocumento,
  numeroDocumento: request.numeroDocumento,
  telefono: request.telefono,
  fechaNacimiento: request.fechaNacimiento,
});

export function crearHandlers({ autenticacion, recuperacion, oauth, salud }) {
  return {
    Salud: salud,

    /* ---------------------------------------------------------------- sesion */

    IniciarSesion: (request) =>
      autenticacion.iniciarSesion({
        identificador: request.identificador,
        password: request.password,
        contexto: contextoDe(request),
      }),

    Registrar: (request) =>
      autenticacion.registrar(
        { ...fichaDe(request), email: request.email, password: request.password },
        contextoDe(request)
      ),

    ValidarToken: (request) => autenticacion.validarToken(request.token),

    async CerrarSesion(request) {
      await autenticacion.cerrarSesion(request.token, contextoDe(request));
      return {};
    },

    async CerrarTodasLasSesiones(request) {
      const sesionesCerradas = await autenticacion.cerrarTodasLasSesiones(request.idUsuario);
      return { sesionesCerradas };
    },

    /* ------------------------------------------- cuentas de Google y Microsoft */

    ListarProveedores: async () => ({ proveedores: oauth.listarProveedores() }),

    UrlAutorizacionExterna: async (request) => ({
      url: oauth.urlAutorizacionExterna({
        proveedor: request.proveedor,
        redirectUri: request.redirectUri,
        state: request.state,
        nonce: request.nonce,
        codeChallenge: request.codeChallenge,
      }),
    }),

    IniciarSesionExterna: (request) =>
      oauth.iniciarSesionExterna({
        proveedor: request.proveedor,
        code: request.code,
        codeVerifier: request.codeVerifier,
        redirectUri: request.redirectUri,
        nonce: request.nonce,
        contexto: contextoDe(request),
      }),

    /* ---------------------------------------------------------------- perfil */

    ObtenerUsuario: (request) => autenticacion.obtenerUsuario(request.idUsuario),

    // nombres/apellidos/telefono son `optional`: undefined = no se toca.
    ActualizarPerfil: (request) =>
      autenticacion.actualizarPerfil(request.idUsuario, {
        nombres: request.nombres,
        apellidos: request.apellidos,
        telefono: request.telefono,
      }),

    CompletarPerfil: (request) => autenticacion.completarPerfil(request.idUsuario, fichaDe(request)),

    ListarTiposDocumento: async () => ({ tipos: await autenticacion.listarTiposDocumento() }),

    /* ------------------------------------------- recuperacion de contraseña */

    BuscarCuenta: (request) => recuperacion.buscarCuenta(request.identificador),

    SolicitarCodigo: (request) =>
      recuperacion.solicitarCodigo({
        identificador: request.identificador,
        metodo: request.metodo,
        contexto: contextoDe(request),
      }),

    VerificarCodigo: (request) =>
      recuperacion.verificarCodigo({ token: request.token, codigo: request.codigo }),

    RestablecerPassword: (request) =>
      recuperacion.restablecerPassword({
        resetToken: request.resetToken,
        password: request.password,
        contexto: contextoDe(request),
      }),
  };
}
