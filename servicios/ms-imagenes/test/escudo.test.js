/**
 * Generador de escudos SVG: bien formado, con el codigo, el contraste
 * correcto (Real Madrid es claro: texto oscuro) y aceptado por la propia
 * validacion de SVG del servicio.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contrasteTexto, sombra } from '../db/color.js';
import { EQUIPOS } from '../db/equipos.js';
import { escudoSvg } from '../db/escudo.js';
import { motivoSvgInseguro, validarSubida } from '../src/utils/validacion.js';

/** Comprobacion minima de XML bien formado: etiquetas balanceadas y & escapados. */
function bienFormado(xml) {
  const cuerpo = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const pila = [];
  const etiqueta = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let ultimo = 0;
  let m;
  while ((m = etiqueta.exec(cuerpo))) {
    const texto = cuerpo.slice(ultimo, m.index);
    if (/[<>]/.test(texto) || /&(?!amp;|lt;|gt;|quot;|apos;)/.test(texto)) return `texto invalido: ${texto}`;
    ultimo = etiqueta.lastIndex;
    const [, cierre, nombre, , autocierre] = m;
    if (autocierre) continue;
    if (!cierre) pila.push(nombre);
    else if (pila.pop() !== nombre) return `cierre inesperado </${nombre}>`;
  }
  if (cuerpo.slice(ultimo).trim()) return 'sobra texto al final';
  return pila.length === 0 ? null : `sin cerrar: ${pila.join(',')}`;
}

test('los 16 escudos son SVG bien formados, con su codigo y validos para subir', () => {
  assert.equal(EQUIPOS.length, 16);
  assert.deepEqual(EQUIPOS.map((e) => e.id), Array.from({ length: 16 }, (_, i) => i + 1));
  for (const equipo of EQUIPOS) {
    const svg = escudoSvg(equipo);
    assert.equal(bienFormado(svg), null, `${equipo.codigo}: ${bienFormado(svg)}`);
    assert.match(svg, /<svg [^>]*viewBox="0 0 100 100"/);
    assert.ok(svg.includes(`>${equipo.codigo}</text>`), `${equipo.codigo} debe ir en el texto`);
    assert.ok(svg.includes(`stop-color="${equipo.primario}"`));
    assert.ok(svg.includes(`stop-color="${sombra(equipo.primario, -0.42)}"`));
    assert.ok(svg.includes(`fill="${equipo.secundario}" fill-opacity="0.42"`));
    assert.ok(!/script|href|https?:\/\/(?!www\.w3\.org)/i.test(svg), 'sin scripts ni recursos externos');
    assert.equal(motivoSvgInseguro(Buffer.from(svg)), null);
    validarSubida(
      { entidad: 'equipo', idEntidad: String(equipo.id), tipoMime: 'image/svg+xml', contenido: Buffer.from(svg) },
      { maxBytes: 5 * 1024 * 1024 }
    );
  }
});

test('contraste: texto oscuro sobre Real Madrid (#f4f6fb), claro sobre Millonarios', () => {
  const realMadrid = EQUIPOS.find((e) => e.codigo === 'RMA');
  assert.equal(realMadrid.primario, '#f4f6fb');
  assert.match(escudoSvg(realMadrid), /fill="#050B18"[^>]*>RMA<\/text>/);
  assert.match(escudoSvg(EQUIPOS.find((e) => e.codigo === 'MIL')), /fill="#F4F6FB"[^>]*>MIL<\/text>/);
  // Junior (amarillo) y River (blanco) tambien son claros.
  assert.equal(contrasteTexto('#e8d21c'), '#050B18');
  assert.equal(contrasteTexto('#f4f6fb'), '#050B18');
});

test('sombra() da lo mismo que shade() del monolito', () => {
  assert.equal(sombra('#123a8f', -0.42), '#0a2253');
  assert.equal(sombra('#ffffff', -0.5), '#808080');
  assert.equal(sombra('#000000', 0.5), '#808080');
});

test('las tres bandas de crest_seed (como .gd-crest--band-0/1/2)', () => {
  const base = { codigo: 'TST', primario: '#123a8f', secundario: '#ffffff' };
  assert.match(escudoSvg({ ...base, crestSeed: 0 }), /transform="rotate\(28 50 50\)"/); // franja diagonal 118deg
  assert.match(escudoSvg({ ...base, crestSeed: 1 }), /<rect x="50" y="0" width="50" height="100"\/>/); // mitades
  assert.equal((escudoSvg({ ...base, crestSeed: 2 }).match(/width="10" height="100"/g) ?? []).length, 3); // tres rayas
  assert.equal(escudoSvg({ ...base, crestSeed: 4 }), escudoSvg({ ...base, crestSeed: 1 })); // % 3
});

test('el texto se escapa', () => {
  const svg = escudoSvg({ codigo: 'A&B', nombre: 'Uno <dos> "tres"' });
  assert.ok(svg.includes('>A&amp;B</text>'));
  assert.ok(svg.includes('<title>Uno &lt;dos&gt; &quot;tres&quot;</title>'));
  assert.equal(bienFormado(svg), null);
});
