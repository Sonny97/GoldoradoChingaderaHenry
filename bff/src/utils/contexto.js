/**
 * Lo que el BFF sabe de la peticion HTTP y los microservicios no.
 *
 * Ningun microservicio ve al navegador: solo ve al BFF. Por eso la IP real,
 * el navegador (para la tabla Sesion y los logs de seguridad) y el id de
 * correlacion se sacan aqui y viajan en cada llamada gRPC.
 */

/** IP real del cliente (respeta TRUST_PROXY: detras de Vite o nginx es la de X-Forwarded-For). */
export function ipDe(req) {
  return req.ip ?? req.socket?.remoteAddress ?? '0.0.0.0';
}

/** ContextoCliente del .proto de autenticacion. */
export function contextoCliente(req) {
  return {
    ip: ipDe(req),
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 400),
  };
}

/** Opciones por llamada gRPC: id de correlacion + lo que se quiera agregar (plazoMs). */
export function opciones(req, extra = {}) {
  return { idSolicitud: req.idSolicitud, ...extra };
}

/** Cadena segura para un campo `string` del .proto (un objeto en el body no rompe la serializacion). */
export function texto(valor) {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return '';
}

/** Texto opcional: undefined (no se envia) si no vino. */
export function textoOpcional(valor) {
  if (valor === undefined || valor === null) return undefined;
  return texto(valor);
}

/** Entero positivo de la query o del body; undefined si no vino o no es valido. */
export function enteroPositivo(valor) {
  if (valor === undefined || valor === null || valor === '') return undefined;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Limite de lista: entero 1..maximo, o el valor por defecto. */
export function limiteDe(valor, defecto, maximo = 100) {
  const n = enteroPositivo(valor);
  if (n === undefined) return defecto;
  return Math.min(n, maximo);
}

/** Token Bearer de la cabecera Authorization, o null. */
export function tokenDeCabecera(req) {
  const cabecera = String(req.headers.authorization ?? '');
  const coincide = /^Bearer\s+(\S+)\s*$/i.exec(cabecera);
  return coincide ? coincide[1] : null;
}
