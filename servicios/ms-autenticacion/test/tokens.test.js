/**
 * JWT + Sesion: el token de seguridad.
 *
 * Lo importante: vencido, falsificado, mal formado y revocado responden lo
 * MISMO, y un token con firma valida deja de servir apenas se revoca su fila.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { CODIGOS } from '@goldorado/comun';

import { crearTokens, crearEmisorSesiones, normalizarDuracion, MENSAJE_SESION_EXPIRADA } from '../src/servicios/tokens.js';
import { crearServicioAutenticacion } from '../src/servicios/autenticacionServicio.js';
import {
  crearReloj,
  crearAuditoriaFalsa,
  crearUsuariosFalsos,
  crearSesionesFalsas,
  filaUsuario,
} from './apoyo/falsos.js';

const SECRETO = 's'.repeat(40);
const esSesionExpirada = (error) =>
  error.codigo === CODIGOS.UNAUTHENTICATED && error.message === MENSAJE_SESION_EXPIRADA;

function armar() {
  const reloj = crearReloj();
  const tokens = crearTokens({ secreto: SECRETO, duracion: '2h', reloj });
  const usuarios = crearUsuariosFalsos([filaUsuario({ password_hash: '$2a$04$x' })]);
  const sesiones = crearSesionesFalsas(usuarios);
  const auditoria = crearAuditoriaFalsa();
  const emitirSesion = crearEmisorSesiones({ tokens, sesiones });
  const servicio = crearServicioAutenticacion({ usuarios, sesiones, tokens, emitirSesion, auditoria, reloj });
  return { reloj, tokens, usuarios, sesiones, auditoria, emitirSesion, servicio };
}

test('normalizarDuracion: digitos solos son SEGUNDOS, no milisegundos', () => {
  assert.equal(normalizarDuracion('7200'), 7200);
  assert.equal(normalizarDuracion(' 2h '), '2h');
  assert.throws(() => crearTokens({ secreto: SECRETO, duracion: 'dos horas' }));
});

test('emitirSesion: la fila Sesion vence exactamente cuando el JWT', async () => {
  const { emitirSesion, sesiones, reloj } = armar();
  const { token, expiraEn } = await emitirSesion({
    idUsuario: 1,
    rol: 'cliente',
    proveedor: 'LOCAL',
    contexto: { ip: '127.0.0.1', userAgent: 'prueba' },
  });

  const payload = jwt.decode(token);
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'jti', 'rol', 'sub'], 'nada de correo ni documento');
  assert.equal(payload.sub, '1');
  assert.equal(payload.exp - payload.iat, 2 * 3600);
  assert.equal(payload.iat, Math.floor(reloj.ahora() / 1000), 'iat sale del reloj inyectado');

  const fila = sesiones.filas.get(payload.jti);
  assert.equal(fila.proveedor, 'LOCAL');
  assert.equal(fila.expira_en.getTime(), payload.exp * 1000);
  assert.equal(expiraEn, new Date(payload.exp * 1000).toISOString());
});

test('ValidarToken: vencido y falsificado dan el MISMO UNAUTHENTICATED', async () => {
  const { servicio, emitirSesion, reloj } = armar();
  const { token } = await emitirSesion({ idUsuario: 1, rol: 'cliente', proveedor: 'LOCAL' });

  const valido = await servicio.validarToken(token);
  assert.deepEqual(
    { ...valido, jti: typeof valido.jti },
    { idUsuario: 1, rol: 'cliente', jti: 'string', perfilCompleto: true, expiraEn: valido.expiraEn }
  );

  // Falsificado: mismo payload firmado con otro secreto.
  const payload = jwt.decode(token);
  const falso = jwt.sign(payload, 'otro-secreto-de-40-caracteres-xxxxxxxxxxx');
  await assert.rejects(servicio.validarToken(falso), esSesionExpirada);

  // alg "none": sin firma. Se rechaza aunque el payload sea el correcto.
  const sinFirma = jwt.sign(payload, null, { algorithm: 'none' });
  await assert.rejects(servicio.validarToken(sinFirma), esSesionExpirada);

  await assert.rejects(servicio.validarToken('esto-no-es-un-jwt'), esSesionExpirada);
  await assert.rejects(servicio.validarToken(''), esSesionExpirada);

  // Vencido: dos horas y un segundo despues.
  reloj.avanzar(2 * 3600 * 1000 + 1000);
  await assert.rejects(servicio.validarToken(token), esSesionExpirada);
});

test('CerrarSesion revoca la fila: el JWT sigue firmado y vigente, pero ya no sirve', async () => {
  const { servicio, emitirSesion, sesiones, auditoria } = armar();
  const { token } = await emitirSesion({ idUsuario: 1, rol: 'cliente', proveedor: 'LOCAL' });
  const { jti } = jwt.decode(token);

  await servicio.cerrarSesion(token, { ip: '10.0.0.1' });
  assert.equal(sesiones.filas.get(jti).motivo_revocacion, 'CIERRE_SESION');
  await assert.rejects(servicio.validarToken(token), esSesionExpirada);

  // Idempotente y silencioso: segunda vez y token basura no lanzan ni duplican eventos.
  await servicio.cerrarSesion(token);
  await servicio.cerrarSesion('basura');
  assert.equal(auditoria.eventos.filter((e) => e.tipo === 'CIERRE_SESION').length, 1);
});

test('ValidarToken: usuario desactivado o sesion inexistente -> mismo mensaje', async () => {
  const { servicio, emitirSesion, usuarios, tokens } = armar();
  const { token } = await emitirSesion({ idUsuario: 1, rol: 'cliente', proveedor: 'LOCAL' });

  usuarios.tabla.get(1).activo = false;
  await assert.rejects(servicio.validarToken(token), esSesionExpirada);

  // Firma valida pero jti que nunca se guardo en Sesion.
  const huerfano = tokens.firmar({ idUsuario: 1, rol: 'cliente', jti: '6f1c2a3b-0000-4000-8000-000000000000' });
  await assert.rejects(servicio.validarToken(huerfano.token), esSesionExpirada);
});

test('CerrarTodasLasSesiones cuenta solo las vivas', async () => {
  const { servicio, emitirSesion, reloj } = armar();
  await emitirSesion({ idUsuario: 1, rol: 'cliente', proveedor: 'LOCAL' });
  reloj.avanzar(3 * 3600 * 1000); // la primera ya vencio
  const { token } = await emitirSesion({ idUsuario: 1, rol: 'cliente', proveedor: 'GOOGLE' });
  await emitirSesion({ idUsuario: 1, rol: 'cliente', proveedor: 'LOCAL' });

  assert.equal(await servicio.cerrarTodasLasSesiones(1), 2);
  await assert.rejects(servicio.validarToken(token), esSesionExpirada);
  assert.equal(await servicio.cerrarTodasLasSesiones(1), 0);
});
