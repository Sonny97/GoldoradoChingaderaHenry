/**
 * Validacion de subidas: tipos, tamaño, numeros magicos y SVG peligrosos.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';

import { motivoSvgInseguro, nombreSeguro, normalizarTipo, validarSubida } from '../src/utils/validacion.js';
import { bytesDe } from './falsos.js';

const MAX = 5 * 1024 * 1024;
const base = { entidad: 'usuario', idEntidad: '7' };
const subir = (extra) => validarSubida({ ...base, ...extra }, { maxBytes: MAX });
const svg = (cuerpo) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${cuerpo}</svg>`);

/** assert.throws con el codigo gRPC y el mensaje exacto en español. */
function rechaza(fn, mensaje) {
  assert.throws(fn, (error) => {
    assert.equal(error.codigo, CODIGOS.INVALID_ARGUMENT);
    assert.equal(error.message, mensaje);
    return true;
  });
}

test('acepta los cuatro formatos cuando los bytes coinciden con el tipo', () => {
  assert.equal(subir({ tipoMime: 'image/png', contenido: bytesDe('png') }).tipoMime, 'image/png');
  assert.equal(subir({ tipoMime: 'image/jpeg', contenido: bytesDe('jpeg') }).tipoMime, 'image/jpeg');
  assert.equal(subir({ tipoMime: 'image/webp', contenido: bytesDe('webp') }).tipoMime, 'image/webp');
  assert.equal(subir({ tipoMime: 'image/svg+xml', contenido: svg('<circle cx="5" cy="5" r="4"/>') }).tipoMime, 'image/svg+xml');
});

test('normaliza el tipo declarado (mayusculas, parametros, alias jpg)', () => {
  assert.equal(normalizarTipo('IMAGE/JPG'), 'image/jpeg');
  assert.equal(normalizarTipo('image/svg+xml; charset=utf-8'), 'image/svg+xml');
  rechaza(() => normalizarTipo('image/gif'), 'Solo se aceptan imágenes PNG, JPEG, WEBP o SVG');
  rechaza(() => subir({ tipoMime: 'application/pdf', contenido: Buffer.from('%PDF-1.7') }), 'Solo se aceptan imágenes PNG, JPEG, WEBP o SVG');
});

test('un PNG declarado como JPEG se rechaza por sus numeros magicos', () => {
  rechaza(() => subir({ tipoMime: 'image/jpeg', contenido: bytesDe('png') }), 'El contenido no corresponde a una imagen JPEG válida');
  rechaza(() => subir({ tipoMime: 'image/png', contenido: bytesDe('jpeg') }), 'El contenido no corresponde a una imagen PNG válida');
  rechaza(() => subir({ tipoMime: 'image/webp', contenido: Buffer.from('RIFF0000WAVEfmt ') }), 'El contenido no corresponde a una imagen WEBP válida');
  rechaza(() => subir({ tipoMime: 'image/svg+xml', contenido: Buffer.from('MZ\u0090\u0000 ejecutable') }), 'El contenido no corresponde a una imagen SVG válida');
  // Bytes que no son UTF-8 valido tampoco son un SVG.
  rechaza(() => subir({ tipoMime: 'image/svg+xml', contenido: Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0xfe]) }), 'El contenido no corresponde a una imagen SVG válida');
});

test('tamaño: vacio y por encima del limite', () => {
  rechaza(() => subir({ tipoMime: 'image/png', contenido: Buffer.alloc(0) }), 'La imagen está vacía');
  rechaza(() => subir({ tipoMime: 'image/png', contenido: bytesDe('png', MAX + 1) }), 'La imagen supera 5 MB');
  assert.ok(subir({ tipoMime: 'image/png', contenido: bytesDe('png', MAX) }));
});

test('entidad e idEntidad', () => {
  rechaza(() => subir({ entidad: 'partido', tipoMime: 'image/png', contenido: bytesDe('png') }),
    'Entidad no válida: usa equipo, jugador, estadio, torneo, promocion o usuario');
  rechaza(() => subir({ idEntidad: '  ', tipoMime: 'image/png', contenido: bytesDe('png') }), 'Falta el id de la entidad');
  rechaza(() => subir({ idEntidad: 'x'.repeat(101), tipoMime: 'image/png', contenido: bytesDe('png') }), 'El id de la entidad es demasiado largo');
  assert.equal(subir({ entidad: ' EQUIPO ', tipoMime: 'image/png', contenido: bytesDe('png') }).entidad, 'equipo');
});

test('SVG con <script> u onload= se rechaza', () => {
  rechaza(() => subir({ tipoMime: 'image/svg+xml', contenido: svg('<script>alert(1)</script>') }), 'El SVG contiene código no permitido');
  rechaza(
    () => subir({ tipoMime: 'image/svg+xml', contenido: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>') }),
    'El SVG contiene código no permitido'
  );
  assert.match(motivoSvgInseguro(svg('<SCRIPT >x</SCRIPT>')), /script/);
  assert.match(motivoSvgInseguro(svg('<rect width="1" height="1" onclick = "x()"/>')), /on\.\.\./);
});

test('SVG: javascript:, href externos, url() externos, foreignObject y DOCTYPE', () => {
  const malos = [
    '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>',
    '<a xlink:href="&#106;avascript:alert(1)">x</a>',
    '<image href="https://evil.example/x.png" width="1" height="1"/>',
    '<image xlink:href="data:image/png;base64,AAAA"/>',
    '<use href=http://evil.example/a.svg#x />',
    '<rect style="fill:url(https://evil.example/p.svg#g)" width="1" height="1"/>',
    '<style>@import url(https://evil.example/a.css);</style>',
    '<foreignObject><div>hola</div></foreignObject>',
  ];
  for (const cuerpo of malos) {
    assert.ok(motivoSvgInseguro(svg(cuerpo)), `deberia rechazar: ${cuerpo}`);
  }
  assert.ok(motivoSvgInseguro(Buffer.from('<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>')));
});

test('SVG: referencias internas (#id) y url(#id) se permiten', () => {
  const bueno = svg(
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
      '<rect width="10" height="10" fill="url(#g)"/><use href="#g"/><use xlink:href=\'#g\'/>'
  );
  assert.equal(motivoSvgInseguro(bueno), null);
});

test('nombreSeguro quita rutas y caracteres raros, y arma uno si no viene', () => {
  assert.equal(nombreSeguro('C:\\fotos\\..\\yo<1>.png', { entidad: 'usuario', idEntidad: '7', tipoMime: 'image/png' }), 'yo1.png');
  assert.equal(nombreSeguro('', { entidad: 'equipo', idEntidad: '5', tipoMime: 'image/svg+xml' }), 'equipo-5.svg');
});
