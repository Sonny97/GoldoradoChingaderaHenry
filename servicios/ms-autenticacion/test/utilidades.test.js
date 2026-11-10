/**
 * Funciones puras: mascaras, validadores del registro (los del monolito, ahora
 * en el servidor) y la forma publica del usuario.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enmascararEmail, enmascararTelefono } from '../src/utils/mask.js';
import {
  puntajePassword,
  errorPassword,
  edad,
  esMayorDeEdad,
  esFechaIso,
  hoyEnZona,
  validarRegistro,
  validarCambiosPerfil,
} from '../src/utils/validadores.js';
import { aUsuarioPublico } from '../src/utils/usuarioPublico.js';
import { filaUsuario, TIPOS_DOCUMENTO } from './apoyo/falsos.js';

test('mascaras: mismo formato del monolito (****@dominio / ***** 567)', () => {
  assert.equal(enmascararEmail('valentina.mesa@hotmail.com'), '****@hotmail.com');
  assert.equal(enmascararEmail('sin-arroba'), '****');
  assert.equal(enmascararEmail(null), '****');
  assert.equal(enmascararTelefono('3109876123'), '***** 123');
  assert.equal(enmascararTelefono('+57 (300) 123-4567'), '***** 567');
  assert.equal(enmascararTelefono('12'), '*****');
  assert.equal(enmascararTelefono(undefined), '*****');
});

test('puntajePassword: port literal de scorePassword()', () => {
  assert.equal(puntajePassword(''), 0);
  assert.equal(puntajePassword('Ab1!'), 1, 'corta: nunca pasa de 1');
  assert.equal(puntajePassword('abcdefgh'), 1);
  assert.equal(puntajePassword('Abcdefgh'), 2);
  assert.equal(puntajePassword('Abcdefg1'), 3);
  assert.equal(puntajePassword('Demo1234!'), 4);
  assert.equal(puntajePassword('abc12!'), 2, 'de 6 a 7 caracteres si suma, pero no llega a 3 sin mayuscula');
});

test('errorPassword: mismos mensajes que validateNewPassword()', () => {
  assert.equal(errorPassword(''), 'Ingresa una contraseña');
  assert.equal(errorPassword('Ab1!'), 'Mínimo 8 caracteres');
  assert.equal(errorPassword('abcdefgh'), 'Debe incluir una mayúscula, un número y un símbolo');
  assert.equal(errorPassword('Abcdefg1'), null, 'puntaje 3 basta');
  assert.equal(errorPassword('Vale2024*'), null);
});

test('fecha ISO estricta: el formato no basta, la fecha tiene que existir', () => {
  assert.ok(esFechaIso('1996-03-11'));
  assert.ok(esFechaIso('2008-02-29'));
  assert.ok(!esFechaIso('2023-02-29'));
  assert.ok(!esFechaIso('2023-02-30'));
  assert.ok(!esFechaIso('11/03/1996'));
  assert.ok(!esFechaIso('1850-01-01'));
});

test('mayoria de edad con el calendario de Bogota, sin importar la zona del servidor', () => {
  // 9 de nov. 2026 a las 23:30 en Bogota = 10 de nov. 04:30 UTC.
  const nocheEnBogota = Date.parse('2026-11-10T04:30:00Z');
  assert.equal(hoyEnZona(nocheEnBogota).iso, '2026-11-09');
  assert.equal(hoyEnZona(nocheEnBogota, 'UTC').iso, '2026-11-10');

  // Cumple 18 el 10 de noviembre: en Bogota todavia tiene 17 (en UTC ya 18).
  assert.equal(edad('2008-11-10', nocheEnBogota), 17);
  assert.equal(esMayorDeEdad('2008-11-10', nocheEnBogota), false);
  assert.equal(esMayorDeEdad('2008-11-10', nocheEnBogota, 'UTC'), true);

  // 00:30 del 10 en Bogota: ya cumplio.
  const madrugada = Date.parse('2026-11-10T05:30:00Z');
  assert.equal(esMayorDeEdad('2008-11-10', madrugada), true);

  // Nacido un 29 de febrero: en año no bisiesto cumple el 1 de marzo.
  assert.equal(edad('2008-02-29', Date.parse('2026-02-28T17:00:00Z')), 17);
  assert.equal(edad('2008-02-29', Date.parse('2026-03-01T17:00:00Z')), 18);
});

test('validarRegistro: mensajes del formulario del monolito, campo por campo', () => {
  const opciones = { tiposValidos: TIPOS_DOCUMENTO.map((t) => t.codigo), ahoraMs: Date.parse('2026-11-09T15:00:00Z') };
  const valido = {
    nombres: 'Camilo',
    apellidos: 'Rojas',
    email: 'camilo@goldorado.co',
    password: 'Demo1234!',
    tipoDocumento: 'CC',
    numeroDocumento: '1012345678',
    telefono: '3001234567',
    fechaNacimiento: '1996-03-11',
  };
  assert.deepEqual(validarRegistro(valido, opciones), {});

  const errores = validarRegistro(
    {
      nombres: 'C4milo',
      apellidos: '',
      email: 'camilo@',
      password: 'abcdefgh',
      tipoDocumento: 'XX',
      numeroDocumento: '12ab',
      telefono: '123',
      fechaNacimiento: '2010-01-01',
    },
    opciones
  );
  assert.deepEqual(errores, {
    nombres: 'El nombre solo admite letras',
    apellidos: 'Ingresa tu apellido',
    email: 'Correo electrónico inválido',
    password: 'Debe incluir una mayúscula, un número y un símbolo',
    tipoDocumento: 'Selecciona el tipo de documento',
    numeroDocumento: 'El documento solo admite números',
    telefono: 'Teléfono inválido',
    fechaNacimiento: 'Debes ser mayor de 18 años',
  });

  assert.equal(validarRegistro({ ...valido, fechaNacimiento: '2027-01-01' }, opciones).fechaNacimiento, 'La fecha no puede ser futura');
  assert.equal(validarRegistro({ ...valido, nombres: 'José Ñúñez' }, opciones).nombres, undefined, 'tildes y eñe son letras');
});

test('validarCambiosPerfil: solo valida lo que llego', () => {
  assert.deepEqual(validarCambiosPerfil({}), {});
  assert.deepEqual(validarCambiosPerfil({ telefono: '31098' }), { telefono: 'Teléfono inválido' });
  assert.deepEqual(validarCambiosPerfil({ nombres: '' }), { nombres: 'Ingresa tu nombre' });
});

test('aUsuarioPublico: nunca el hash; nombre desde Google si aun no hay ficha', () => {
  const camilo = aUsuarioPublico(filaUsuario({ password_hash: '$2a$10$x', ultimo_login: new Date('2026-08-17T20:01:00Z') }));
  assert.equal(camilo.id, 1);
  assert.equal(camilo.nombreCompleto, 'Camilo Rojas');
  assert.equal(camilo.fechaNacimiento, '1996-03-11');
  assert.equal(camilo.rol, 'cliente');
  assert.equal(camilo.tienePassword, true);
  assert.equal(camilo.ultimoLogin, '2026-08-17T20:01:00.000Z');
  assert.ok(!JSON.stringify(camilo).includes('$2a$'), 'el hash no sale');

  const andres = aUsuarioPublico(
    filaUsuario({
      id_usuario: '4',
      email: 'andres.gomez.demo@gmail.com',
      tiene_cliente: false,
      nombres: null,
      apellidos: null,
      tipo_documento: null,
      numero_documento: null,
      fecha_nacimiento: null,
      telefono: null,
      nombre_proveedor: 'Andrés Gómez Pardo',
      proveedores: 'GOOGLE',
    })
  );
  assert.equal(andres.nombres, 'Andrés');
  assert.equal(andres.apellidos, 'Gómez Pardo');
  assert.equal(andres.perfilCompleto, false);
  assert.equal(andres.tienePassword, false);
  assert.deepEqual(andres.proveedores, ['GOOGLE']);
  assert.equal(andres.numeroDocumento, undefined, 'optional ausente, no cadena vacia');
  assert.equal(andres.ultimoLogin, undefined);
});
