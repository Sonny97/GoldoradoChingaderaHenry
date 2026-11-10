/**
 * Login, registro y perfil con repositorios falsos (sin SQL Server).
 *
 * La regla central del monolito se prueba caso por caso: no existe, clave
 * mala, campos vacios y cuenta sin clave local responden EXACTAMENTE lo mismo,
 * y cada intento queda registrado en la auditoria.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { CODIGOS } from '@goldorado/comun';

import { crearTokens, crearEmisorSesiones } from '../src/servicios/tokens.js';
import { crearServicioAutenticacion, MENSAJES } from '../src/servicios/autenticacionServicio.js';
import {
  crearReloj,
  crearAuditoriaFalsa,
  crearUsuariosFalsos,
  crearSesionesFalsas,
  filaUsuario,
  hashRapido,
} from './apoyo/falsos.js';

const HASH_DEMO = hashRapido('Demo1234!');
const CONTEXTO = { ip: '190.85.12.44', userAgent: 'Mozilla/5.0 prueba' };

function armar(filas) {
  const reloj = crearReloj();
  const usuarios = crearUsuariosFalsos(
    filas ?? [
      filaUsuario({ password_hash: HASH_DEMO }),
      filaUsuario({
        id_usuario: '3',
        email: 'admin@goldorado.co',
        password_hash: hashRapido('Admin2026#'),
        tiene_cliente: false,
        nombres: null,
        apellidos: null,
        numero_documento: null,
        tipo_documento: null,
        fecha_nacimiento: null,
        telefono: null,
        rol: 'ADMIN',
      }),
      filaUsuario({
        id_usuario: '4',
        email: 'andres.gomez.demo@gmail.com',
        password_hash: null,
        tiene_cliente: false,
        numero_documento: null,
        nombre_proveedor: 'Andrés Gómez',
      }),
    ]
  );
  const sesiones = crearSesionesFalsas(usuarios);
  const auditoria = crearAuditoriaFalsa();
  const tokens = crearTokens({ secreto: 'k'.repeat(40), duracion: '2h', reloj });
  const emitirSesion = crearEmisorSesiones({ tokens, sesiones });
  const servicio = crearServicioAutenticacion({ usuarios, sesiones, tokens, emitirSesion, auditoria, reloj });
  return { servicio, usuarios, sesiones, auditoria };
}

const credencialesInvalidas = (error) =>
  error.codigo === CODIGOS.UNAUTHENTICATED && error.message === MENSAJES.credencialesInvalidas;

test('login: no existe, clave mala, vacio y sin clave local -> el MISMO mensaje', async () => {
  const { servicio, auditoria, sesiones } = armar();
  const casos = [
    [{ identificador: 'noexiste@goldorado.co', password: 'Demo1234!' }, 'Usuario no encontrado', undefined],
    [{ identificador: 'demo@goldorado.co', password: 'Otra1234!' }, 'Contraseña incorrecta', 1],
    [{ identificador: '   ', password: 'x' }, 'Credenciales incompletas', undefined],
    [{ identificador: 'demo@goldorado.co', password: '' }, 'Credenciales incompletas', undefined],
    [{ identificador: 'andres.gomez.demo@gmail.com', password: 'Cualquiera1!' }, 'Cuenta sin contraseña local', 4],
  ];

  for (const [datos, motivo, idUsuario] of casos) {
    await assert.rejects(servicio.iniciarSesion({ ...datos, contexto: CONTEXTO }), credencialesInvalidas);
    const intento = auditoria.intentos.at(-1);
    assert.equal(intento.motivoFallo, motivo);
    assert.equal(intento.idUsuario, idUsuario);
    assert.equal(intento.exitoso, false);
    assert.equal(intento.proveedor, 'LOCAL');
    assert.equal(intento.ip, CONTEXTO.ip);
  }
  assert.equal(auditoria.intentos.length, casos.length, 'todo intento queda registrado');
  assert.equal(sesiones.filas.size, 0, 'ningun fallo emite sesion');
});

test('login: cuenta inactiva -> PERMISSION_DENIED con el mensaje del monolito', async () => {
  const { servicio, usuarios, auditoria } = armar();
  usuarios.tabla.get(1).activo = false;
  await assert.rejects(
    servicio.iniciarSesion({ identificador: 'demo@goldorado.co', password: 'Demo1234!', contexto: CONTEXTO }),
    (error) => error.codigo === CODIGOS.PERMISSION_DENIED && error.message === MENSAJES.cuentaInactiva
  );
  assert.equal(auditoria.intentos.at(-1).motivoFallo, 'Cuenta inactiva');
});

test('login correcto por correo o por documento: crea la Sesion y firma el jti', async () => {
  const { servicio, sesiones, auditoria, usuarios } = armar();

  const porDocumento = await servicio.iniciarSesion({ identificador: '1012345678', password: 'Demo1234!', contexto: CONTEXTO });
  const respuesta = await servicio.iniciarSesion({ identificador: ' demo@goldorado.co ', password: 'Demo1234!', contexto: CONTEXTO });

  assert.equal(porDocumento.usuario.id, 1);
  assert.equal(respuesta.usuario.email, 'demo@goldorado.co');
  assert.equal(respuesta.usuario.rol, 'cliente');
  assert.equal(respuesta.esNuevo, false);
  assert.ok(!JSON.stringify(respuesta.usuario).includes(HASH_DEMO), 'el hash no sale');

  const { jti, sub, rol } = jwt.decode(respuesta.token);
  assert.equal(sub, '1');
  assert.equal(rol, 'cliente');
  const fila = sesiones.filas.get(jti);
  assert.equal(fila.proveedor, 'LOCAL');
  assert.equal(fila.ip, CONTEXTO.ip);
  assert.equal(fila.expira_en.toISOString(), respuesta.expiraEn);
  assert.equal(sesiones.filas.size, 2);

  assert.ok(usuarios.tabla.get(1).ultimo_login, 'actualiza ultimo_login');
  const exito = auditoria.intentos.at(-1);
  assert.equal(exito.exitoso, true);
  assert.equal(exito.motivoFallo, undefined);
  assert.equal(exito.idUsuario, 1);
});

test('login del admin (sin ficha de Cliente) funciona: es el porque del LEFT JOIN', async () => {
  const { servicio } = armar();
  const respuesta = await servicio.iniciarSesion({ identificador: 'admin@goldorado.co', password: 'Admin2026#' });
  assert.equal(respuesta.usuario.rol, 'admin');
  assert.equal(respuesta.usuario.perfilCompleto, false);
});

const REGISTRO = {
  email: 'Nueva.Persona@Correo.co',
  password: 'Clave2026!',
  nombres: 'Laura',
  apellidos: 'Pérez',
  tipoDocumento: 'cc',
  numeroDocumento: '52123456',
  telefono: '3157778899',
  fechaNacimiento: '2000-05-20',
};

test('registro: valida en el servidor y entrega sesion iniciada', async () => {
  const { servicio, auditoria, sesiones } = armar();

  await assert.rejects(
    servicio.registrar({ ...REGISTRO, password: 'corta', telefono: 'abc' }),
    (error) =>
      error.codigo === CODIGOS.INVALID_ARGUMENT &&
      error.message === 'Mínimo 8 caracteres' &&
      error.datos.campos.telefono === 'El teléfono solo admite números'
  );

  const respuesta = await servicio.registrar(REGISTRO, CONTEXTO);
  assert.equal(respuesta.usuario.email, 'nueva.persona@correo.co', 'el correo se guarda en minuscula');
  assert.equal(respuesta.usuario.tipoDocumento, 'CC');
  assert.equal(respuesta.usuario.perfilCompleto, true);
  assert.equal(respuesta.esNuevo, true);
  assert.ok(sesiones.filas.has(jwt.decode(respuesta.token).jti));
  assert.equal(auditoria.eventos.at(-1).tipo, 'REGISTRO');
});

test('registro: correo o documento repetidos -> ALREADY_EXISTS, tambien en la carrera', async () => {
  const { servicio, usuarios } = armar();
  const yaExiste = (mensaje) => (error) => error.codigo === CODIGOS.ALREADY_EXISTS && error.message === mensaje;

  await assert.rejects(servicio.registrar({ ...REGISTRO, email: 'DEMO@goldorado.co' }), yaExiste(MENSAJES.correoDuplicado));
  await assert.rejects(servicio.registrar({ ...REGISTRO, numeroDocumento: '1012345678' }), yaExiste(MENSAJES.documentoDuplicado));

  // Otra peticion gano la carrera: los SELECT dijeron que no existia, el UNIQUE dice que si.
  usuarios.fallarProximoInsert = 'email';
  await assert.rejects(servicio.registrar(REGISTRO), yaExiste(MENSAJES.correoDuplicado));
  usuarios.fallarProximoInsert = 'documento';
  await assert.rejects(servicio.registrar(REGISTRO), yaExiste(MENSAJES.documentoDuplicado));
});

test('CompletarPerfil: solo sin ficha, mismas validaciones, documento unico', async () => {
  const { servicio, auditoria } = armar();
  const ficha = {
    nombres: 'Andrés',
    apellidos: 'Gómez',
    tipoDocumento: 'CC',
    numeroDocumento: '80123456',
    telefono: '3204445566',
    fechaNacimiento: '1994-10-02',
  };

  await assert.rejects(
    servicio.completarPerfil(1, ficha),
    (error) => error.codigo === CODIGOS.FAILED_PRECONDITION && error.message === 'Tu perfil ya está completo'
  );
  await assert.rejects(
    servicio.completarPerfil(4, { ...ficha, numeroDocumento: '1012345678' }),
    (error) => error.codigo === CODIGOS.ALREADY_EXISTS && error.message === MENSAJES.documentoDuplicado
  );
  await assert.rejects(
    servicio.completarPerfil(4, { ...ficha, fechaNacimiento: '2015-01-01' }),
    (error) => error.codigo === CODIGOS.INVALID_ARGUMENT && error.message === 'Debes ser mayor de 18 años'
  );

  const usuario = await servicio.completarPerfil(4, ficha, CONTEXTO);
  assert.equal(usuario.perfilCompleto, true);
  assert.equal(usuario.numeroDocumento, '80123456');
  assert.equal(auditoria.eventos.at(-1).tipo, 'PERFIL_COMPLETADO');
});

test('ActualizarPerfil y ObtenerUsuario', async () => {
  const { servicio } = armar();
  const usuario = await servicio.actualizarPerfil(1, { nombres: undefined, apellidos: 'Rojas Díaz', telefono: '3001112233' });
  assert.equal(usuario.apellidos, 'Rojas Díaz');
  assert.equal(usuario.telefono, '3001112233');
  assert.equal(usuario.nombres, 'Camilo', 'lo que no llega no se toca');

  await assert.rejects(servicio.actualizarPerfil(1, { telefono: '12' }), (e) => e.codigo === CODIGOS.INVALID_ARGUMENT);
  await assert.rejects(servicio.actualizarPerfil(4, { nombres: 'Andrés' }), (e) => e.codigo === CODIGOS.FAILED_PRECONDITION);
  await assert.rejects(servicio.obtenerUsuario(999), (e) => e.codigo === CODIGOS.NOT_FOUND && e.message === 'No hay sesión activa');

  const tipos = await servicio.listarTiposDocumento();
  assert.equal(tipos[0].codigo, 'CC');
});
