/**
 * Maquina de estados de la recuperacion de clave, con repositorio falso y
 * reloj manual: mismos mensajes y mismas transiciones que el monolito, ahora
 * con la solicitud persistida (no se borra: se agota o se consume).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { CODIGOS } from '@goldorado/comun';

import { crearServicioRecuperacion, MENSAJES_RECUPERACION as M } from '../src/servicios/recuperacionServicio.js';
import {
  crearReloj,
  crearAuditoriaFalsa,
  crearUsuariosFalsos,
  crearSesionesFalsas,
  crearRecuperacionesFalsas,
  filaUsuario,
  hashRapido,
} from './apoyo/falsos.js';

const DIEZ_MIN = 10 * 60 * 1000;

function armar({ esDesarrollo = true } = {}) {
  const reloj = crearReloj();
  const usuarios = crearUsuariosFalsos([
    filaUsuario({ password_hash: hashRapido('Demo1234!') }),
    filaUsuario({ id_usuario: '3', email: 'admin@goldorado.co', numero_documento: null, telefono: null, rol: 'ADMIN' }),
  ]);
  const sesiones = crearSesionesFalsas(usuarios);
  const recuperaciones = crearRecuperacionesFalsas({ usuarios, sesiones });
  const auditoria = crearAuditoriaFalsa();
  const avisos = [];
  const servicio = crearServicioRecuperacion({
    usuarios,
    recuperaciones,
    auditoria,
    reloj,
    log: { aviso: (m) => avisos.push(m), info() {}, error() {}, debug() {} },
    config: { esDesarrollo, codigoDev: '482913', ttlMs: DIEZ_MIN, maxIntentos: 5 },
    generarCodigo: () => '777111',
    hasher: { hash: (v) => bcrypt.hash(v, 4), compare: bcrypt.compare },
  });
  return { servicio, reloj, usuarios, sesiones, recuperaciones, auditoria, avisos };
}

const muerto = (mensaje) => (error) =>
  error.codigo === CODIGOS.FAILED_PRECONDITION && error.message === mensaje && error.datos?.tokenDead === true;

test('paso 1: destinos enmascarados en el servidor; cuenta inexistente -> NOT_FOUND', async () => {
  const { servicio } = armar();
  assert.deepEqual(await servicio.buscarCuenta('1012345678'), {
    idUsuario: 1,
    emailEnmascarado: '****@goldorado.co',
    telefonoEnmascarado: '***** 567',
    tieneEmail: true,
    tieneSms: true,
  });
  await assert.rejects(servicio.buscarCuenta('nadie@x.co'), (e) => e.codigo === CODIGOS.NOT_FOUND && e.message === M.cuentaNoEncontrada);
});

test('paso 2: en desarrollo devuelve codigoDev; solo se guarda el HASH', async () => {
  const { servicio, recuperaciones, reloj, auditoria } = armar();
  const respuesta = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'sms', contexto: { ip: '1.2.3.4' } });

  assert.equal(respuesta.metodo, 'sms');
  assert.equal(respuesta.destinoEnmascarado, '***** 567');
  assert.equal(respuesta.codigoDev, '482913');
  assert.equal(respuesta.expiraEnMs, reloj.ahora() + DIEZ_MIN);
  assert.match(respuesta.token, /^[0-9a-f]{48}$/);

  const fila = recuperaciones.filas.get(respuesta.token);
  assert.notEqual(fila.codigo_hash, '482913');
  assert.ok(await bcrypt.compare('482913', fila.codigo_hash));
  assert.equal(auditoria.eventos.at(-1).tipo, 'RECUPERACION_SOLICITADA');

  await assert.rejects(
    servicio.solicitarCodigo({ identificador: 'admin@goldorado.co', metodo: 'sms' }),
    (e) => e.codigo === CODIGOS.FAILED_PRECONDITION && e.message === M.sinTelefono
  );
});

test('paso 2 en produccion: codigo aleatorio, no viaja, y el log lo dice', async () => {
  const { servicio, recuperaciones, avisos } = armar({ esDesarrollo: false });
  const respuesta = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'email' });
  assert.equal(respuesta.codigoDev, undefined);
  assert.equal(respuesta.destinoEnmascarado, '****@goldorado.co');
  assert.ok(await bcrypt.compare('777111', recuperaciones.filas.get(respuesta.token).codigo_hash));
  assert.match(avisos.join('\n'), /no hay proveedor de correo\/SMS/);
});

test('paso 3: intentos con el texto del monolito y muerte al agotarlos', async () => {
  const { servicio } = armar();
  const { token } = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'email' });

  const esperados = [
    'El código es incorrecto. Te quedan 4 intentos.',
    'El código es incorrecto. Te quedan 3 intentos.',
    'El código es incorrecto. Te quedan 2 intentos.',
    'El código es incorrecto. Te queda 1 intento.',
  ];
  for (const mensaje of esperados) {
    await assert.rejects(
      servicio.verificarCodigo({ token, codigo: '000000' }),
      (e) => e.codigo === CODIGOS.INVALID_ARGUMENT && e.message === mensaje
    );
  }
  // El quinto fallo la mata en el acto, y despues sigue muerta (aunque el codigo sea el bueno).
  await assert.rejects(servicio.verificarCodigo({ token, codigo: '000000' }), muerto(M.demasiadosIntentos));
  await assert.rejects(servicio.verificarCodigo({ token, codigo: '482913' }), muerto(M.demasiadosIntentos));
});

test('paso 3: vencida o desconocida -> tokenDead', async () => {
  const { servicio, reloj } = armar();
  const { token } = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'email' });

  await assert.rejects(servicio.verificarCodigo({ token: 'f'.repeat(48), codigo: '482913' }), muerto(M.solicitudInvalida));
  reloj.avanzar(DIEZ_MIN);
  await assert.rejects(servicio.verificarCodigo({ token, codigo: '482913' }), muerto(M.solicitudInvalida));
});

test('pasos 3 y 4: verificar no consume; restablecer es de un solo uso y revoca las sesiones', async () => {
  const { servicio, usuarios, sesiones, auditoria } = armar();
  await sesiones.crear({
    jti: 'aaaaaaaa-0000-4000-8000-000000000001',
    idUsuario: 1,
    proveedor: 'LOCAL',
    emitidaEn: new Date(Date.parse('2026-11-09T14:00:00Z')),
    expiraEn: new Date(Date.parse('2026-11-09T16:00:00Z')),
  });

  const { token } = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'email' });
  const primero = await servicio.verificarCodigo({ token, codigo: ' 482913 ' });
  // "Cancelar" desde la nueva clave y volver a verificar: la solicitud sigue viva.
  const { resetToken } = await servicio.verificarCodigo({ token, codigo: '482913' });
  assert.notEqual(primero.resetToken, resetToken, 'el reset_token nuevo reemplaza al anterior');

  await assert.rejects(
    servicio.restablecerPassword({ resetToken, password: 'debil' }),
    (e) => e.codigo === CODIGOS.INVALID_ARGUMENT && e.message === 'Mínimo 8 caracteres'
  );
  await assert.rejects(
    servicio.restablecerPassword({ resetToken: primero.resetToken, password: 'Nueva2026!' }),
    (e) => e.codigo === CODIGOS.FAILED_PRECONDITION && e.message === M.enlaceInvalido
  );

  const { email } = await servicio.restablecerPassword({ resetToken, password: 'Nueva2026!', contexto: { ip: '1.2.3.4' } });
  assert.equal(email, 'demo@goldorado.co');
  assert.ok(await bcrypt.compare('Nueva2026!', usuarios.tabla.get(1).password_hash));
  assert.equal(sesiones.filas.get('aaaaaaaa-0000-4000-8000-000000000001').motivo_revocacion, 'RESTABLECER_PASSWORD');

  const evento = auditoria.eventos.at(-1);
  assert.equal(evento.tipo, 'RECUPERACION_COMPLETADA');
  assert.equal(evento.detalle.sesionesRevocadas, 1);

  // Segundo uso del mismo resetToken, y el paso 3 sobre una solicitud ya usada.
  await assert.rejects(
    servicio.restablecerPassword({ resetToken, password: 'Otra2026!!' }),
    (e) => e.codigo === CODIGOS.FAILED_PRECONDITION && e.message === M.enlaceInvalido
  );
  await assert.rejects(servicio.verificarCodigo({ token, codigo: '482913' }), muerto(M.solicitudInvalida));
});

test('paso 4: el enlace vence con la solicitud; cuenta inactiva no cambia la clave', async () => {
  const { servicio, reloj, usuarios } = armar();
  const { token } = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'email' });
  const { resetToken } = await servicio.verificarCodigo({ token, codigo: '482913' });

  usuarios.tabla.get(1).activo = false;
  await assert.rejects(
    servicio.restablecerPassword({ resetToken, password: 'Nueva2026!' }),
    (e) => e.codigo === CODIGOS.FAILED_PRECONDITION && e.message === M.noActualizada
  );

  usuarios.tabla.get(1).activo = true;
  const segunda = await servicio.solicitarCodigo({ identificador: 'demo@goldorado.co', metodo: 'email' });
  const otro = await servicio.verificarCodigo({ token: segunda.token, codigo: '482913' });
  reloj.avanzar(DIEZ_MIN + 1);
  await assert.rejects(
    servicio.restablecerPassword({ resetToken: otro.resetToken, password: 'Nueva2026!' }),
    (e) => e.codigo === CODIGOS.FAILED_PRECONDITION && e.message === M.enlaceInvalido
  );
});
