// =============================================================================
//  Reglas de auditoria: intentos de sesion y eventos de seguridad.
//
//  Quien llama (ms-autenticacion, ms-pagos) lo hace con llamadaOpcional(): si
//  Mongo esta caido el login igual funciona. Por eso aqui se prefiere GUARDAR
//  la traza normalizada (recortada, con defectos) antes que rechazarla; solo
//  se rechaza lo que el monolito tambien prohibia, como un intento fallido
//  sin motivo (CHK_LogSesion_Motivo).
// =============================================================================

import { invalido } from '@goldorado/comun';
import { PATRON_TIPO_EVENTO, PROVEEDORES_SESION, SEVERIDADES } from '../esquema.js';
import { enumerado, fechaOpcional, idOpcional, limite, textoOpcional } from '../utils/entrada.js';

const PATRON_TIPO = new RegExp(PATRON_TIPO_EVENTO);

/**
 * El correo es la llave del conteo de fuerza bruta: sin espacios y en
 * minuscula, para que "Demo@..." y "demo@..." cuenten como el MISMO objetivo.
 */
export function normalizarCorreo(valor) {
  return textoOpcional(valor, 150)?.toLowerCase();
}

export function validarIntento(req, ahora) {
  const emailIntento = normalizarCorreo(req.emailIntento);
  if (!emailIntento) throw invalido('El correo del intento es obligatorio');
  const exitoso = Boolean(req.exitoso);
  const motivoFallo = textoOpcional(req.motivoFallo, 100);
  // Un intento fallido SIEMPRE tiene que decir por que fallo.
  if (!exitoso && !motivoFallo) throw invalido('Un intento fallido debe decir por qué falló');
  return {
    // null a proposito: el correo tecleado no existe (la traza de fuerza bruta).
    idUsuario: idOpcional(req.idUsuario),
    emailIntento,
    ip: textoOpcional(req.ip, 45) ?? 'desconocida',
    userAgent: textoOpcional(req.userAgent, 255),
    exitoso,
    motivoFallo,
    proveedor: enumerado(req.proveedor, PROVEEDORES_SESION, {
      defecto: 'LOCAL',
      mensaje: 'Proveedor de inicio de sesión inválido: usa LOCAL, GOOGLE o MICROSOFT',
    }),
    fecha: fechaOpcional(req.fecha, ahora),
  };
}

export function validarConteo(req) {
  const emailIntento = normalizarCorreo(req.emailIntento);
  if (!emailIntento) throw invalido('El correo del intento es obligatorio');
  // 0 = 15 minutos, la ventana del monolito; nunca mas de un dia.
  return { emailIntento, ventanaMinutos: limite(req.ventanaMinutos, 15, 24 * 60) };
}

/**
 * `detalle` llega como texto JSON y se guarda como OBJETO para poder
 * consultarlo por campo. Si no es un objeto JSON valido no se pierde: se
 * guarda envuelto ({ texto } o { valor }).
 */
export function interpretarDetalle(texto) {
  const limpio = textoOpcional(texto);
  if (!limpio) return {};
  try {
    const valor = JSON.parse(limpio);
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : { valor };
  } catch {
    return { texto: limpio };
  }
}

export function validarEvento(req, ahora) {
  const tipo = textoOpcional(req.tipo)?.toUpperCase();
  if (!tipo) throw invalido('El tipo del evento es obligatorio');
  if (!PATRON_TIPO.test(tipo)) throw invalido('Tipo de evento inválido');
  return {
    tipo,
    idUsuario: idOpcional(req.idUsuario),
    ip: textoOpcional(req.ip, 45),
    severidad: enumerado(req.severidad, SEVERIDADES, {
      defecto: 'INFO',
      mensaje: 'Severidad inválida: usa INFO, ADVERTENCIA o CRITICO',
    }),
    detalle: interpretarDetalle(req.detalle),
    origen: textoOpcional(req.origen, 50) ?? 'desconocido',
    fecha: fechaOpcional(req.fecha, ahora),
  };
}

export function validarListadoEventos(req) {
  return {
    idUsuario: idOpcional(req.idUsuario),
    tipo: textoOpcional(req.tipo)?.toUpperCase(),
    limite: limite(req.limite, 50, 200),
  };
}

/**
 * @param {object} o
 * @param {ReturnType<import('../repositorios/seguridad.js').crearRepositorioSeguridad>} o.repo
 * @param {() => Date} [o.reloj]
 */
export function crearServicioSeguridad({ repo, reloj = () => new Date() }) {
  return {
    async registrarIntento(req) {
      await repo.insertarIntento(validarIntento(req, reloj()));
    },

    async contarFallidos(req) {
      const { emailIntento, ventanaMinutos } = validarConteo(req);
      const desde = new Date(reloj().getTime() - ventanaMinutos * 60_000);
      return repo.contarFallidos({ emailIntento, desde });
    },

    async registrarEvento(req) {
      await repo.insertarEvento(validarEvento(req, reloj()));
    },

    listarEventos(req) {
      return repo.listarEventos(validarListadoEventos(req));
    },
  };
}
