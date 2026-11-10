/**
 * Arranque de ms-autenticacion.
 *
 * Orden (CONVENCIONES §2): env -> servidor gRPC -> conexion a SQL Server NO
 * bloqueante -> apagado ordenado.
 *
 * El servidor abre su puerto aunque SQL Server este caido, igual que el
 * monolito respondia /api/salud con la base abajo: Salud dice 'error' con el
 * motivo, cada RPC que toca la base responde UNAVAILABLE, y el pool se
 * reintenta solo en la siguiente peticion. La conexion se intenta al arrancar
 * para que el problema salga en el log en el segundo uno.
 *
 * Aqui (y solo aqui) se arman las dependencias reales; los servicios son
 * fabricas que en las pruebas reciben repositorios falsos.
 */

import {
  crearLogger,
  crearServidorGrpc,
  crearRpcSalud,
  versionDelPaquete,
  apagadoOrdenado,
} from '@goldorado/comun';

import { env } from './config/env.js';
import { obtenerPool, comprobarConexion, cerrarPool, pistaDeConexion } from './config/db.js';
import * as usuarios from './repositorios/usuarioRepo.js';
import * as sesiones from './repositorios/sesionRepo.js';
import * as recuperaciones from './repositorios/recuperacionRepo.js';
import { crearAuditoria } from './clientes/auditoria.js';
import { crearTokens, crearEmisorSesiones } from './servicios/tokens.js';
import { crearServicioAutenticacion } from './servicios/autenticacionServicio.js';
import { crearServicioRecuperacion } from './servicios/recuperacionServicio.js';
import { crearServicioOAuth } from './servicios/oauthServicio.js';
import { crearProveedores } from './servicios/proveedoresOidc.js';
import { crearHandlers } from './grpc/handlers.js';

const NOMBRE = 'ms-autenticacion';
const log = crearLogger(NOMBRE);
const reloj = { ahora: () => Date.now() };

// HS256 con un secreto corto se puede romper por fuerza bruta offline a
// partir de un solo token capturado. No se bloquea el arranque (desarrollo).
if (env.JWT_SECRET.length < 32) {
  log.aviso('JWT_SECRET tiene menos de 32 caracteres: cualquier token capturado permitiria adivinarlo.');
}
if (!env.DB_PASSWORD) log.aviso('DB_PASSWORD esta vacio: SQL Server rechazara el login.');

const tokens = crearTokens({ secreto: env.JWT_SECRET, duracion: env.JWT_EXPIRES_IN, reloj });
const auditoria = crearAuditoria({
  direccion: env.MS_TRANSACCIONES_URL,
  tokenInterno: env.GRPC_TOKEN_INTERNO,
  log,
});
const emitirSesion = crearEmisorSesiones({ tokens, sesiones });
const proveedores = crearProveedores(env);

const handlers = crearHandlers({
  autenticacion: crearServicioAutenticacion({ usuarios, sesiones, tokens, emitirSesion, auditoria, reloj }),
  recuperacion: crearServicioRecuperacion({
    usuarios,
    recuperaciones,
    auditoria,
    log,
    reloj,
    config: {
      esDesarrollo: env.esDesarrollo,
      codigoDev: env.OTP_CODIGO_DEV,
      ttlMs: env.OTP_TTL_MIN * 60 * 1000,
      maxIntentos: env.OTP_MAX_INTENTOS,
    },
  }),
  oauth: crearServicioOAuth({ proveedores, usuarios, emitirSesion, auditoria, log, reloj }),
  salud: crearRpcSalud({
    servicio: NOMBRE,
    motor: 'SQL Server',
    baseDatos: env.DB_DATABASE,
    version: versionDelPaquete(import.meta.url),
    comprobar: comprobarConexion,
  }),
});

const servidor = crearServidorGrpc({ nombre: NOMBRE, log, tokenInterno: env.GRPC_TOKEN_INTERNO });
servidor.registrar('autenticacion', handlers);
const puerto = await servidor.iniciar(env.GRPC_PUERTO, env.GRPC_HOST);

const habilitados = Object.values(proveedores).filter((p) => p.habilitado).map((p) => p.nombre);
log.info(
  `gRPC escuchando en ${env.GRPC_HOST}:${puerto} | SQL Server ${env.DB_SERVER}:${env.DB_PORT}/${env.DB_DATABASE} | ` +
    `proveedores externos: ${habilitados.length ? habilitados.join(', ') : 'ninguno'}`
);

// NO bloqueante: si falla, el servicio sigue arriba y lo reporta en Salud.
obtenerPool().catch((error) => {
  log.aviso(
    `SQL Server no disponible (${error.code ?? error.name}: ${error.message}). ${pistaDeConexion(error)} ` +
      'El servicio sigue arriba y reintenta en cada peticion.'
  );
});

// Primero se deja de recibir llamadas, luego se cierran la base y el cliente.
apagadoOrdenado({
  log,
  tareas: [() => servidor.apagar(5000), () => cerrarPool(), async () => auditoria.cerrar()],
});
