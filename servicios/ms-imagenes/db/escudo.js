/**
 * Escudo SVG de un equipo, IGUAL al escudo CSS del monolito (TeamCrest.jsx +
 * .gd-crest de ui.css), para que la web se vea igual con o sin ms-imagenes:
 *
 *   - disco con el color primario degradado hacia su propia sombra
 *     (sombra(primario, -0.42)); el CSS usa linear-gradient(140deg): aqui es
 *     un degradado radial con la luz arriba a la izquierda, mismo efecto;
 *   - banda decorativa en el color secundario al 42 % de opacidad, elegida
 *     por crest_seed (3 patrones, los de .gd-crest--band-N):
 *        0 = franja diagonal   linear-gradient(118deg, ... 38% .. 56% ...)
 *        1 = mitades verticales linear-gradient(90deg, transparent 50%, banda 50%)
 *        2 = tres rayas         repeating-linear-gradient(90deg, 0 22%, 22% 32%)
 *   - el codigo de 3 letras centrado, en el color de CONTRASTE calculado
 *     (texto oscuro sobre Real Madrid/River/Junior, claro sobre el resto).
 *
 * viewBox 0 0 100 100 (como un escudo de 100 px: el texto mide 28 = 0.28 x tamaño).
 * Sin <script>, sin href ni recursos externos: solo referencias url(#id)
 * internas, asi pasa la validacion de SVG del propio servicio.
 */

import { contrasteTexto, sombra } from './color.js';

const escaparXml = (texto) =>
  String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Franja de un linear-gradient CSS de angulo `grados` que va de `desde` a
 * `hasta` (fracciones de la linea del degradado) sobre una caja de 100x100.
 * CSS: 0deg apunta arriba y crece en sentido horario; la linea del degradado
 * mide |100 sen a| + |100 cos a| y pasa por el centro. La franja es un
 * rectangulo perpendicular a esa linea, rotado (grados - 90) sobre el centro.
 */
function franjaCss(grados, desde, hasta) {
  const a = (grados * Math.PI) / 180;
  const largo = Math.abs(100 * Math.sin(a)) + Math.abs(100 * Math.cos(a));
  const x0 = 50 + (desde - 0.5) * largo;
  const x1 = 50 + (hasta - 0.5) * largo;
  return `<rect x="${r2(x0)}" y="-50" width="${r2(x1 - x0)}" height="200" transform="rotate(${r2(grados - 90)} 50 50)"/>`;
}

/** Las 3 bandas de .gd-crest--band-N. */
export const BANDAS = Object.freeze({
  0: () => franjaCss(118, 0.38, 0.56),
  1: () => '<rect x="50" y="0" width="50" height="100"/>',
  // repeating 90deg: transparente 0-22 %, banda 22-32 %, se repite cada 32 %.
  2: () => [22, 54, 86].map((x) => `<rect x="${x}" y="0" width="10" height="100"/>`).join(''),
});

/**
 * @param {{ codigo: string, nombre?: string, primario?: string, secundario?: string, crestSeed?: number }} equipo
 * @returns {string} documento SVG completo (UTF-8)
 */
export function escudoSvg({ codigo, nombre = codigo, primario = '#101b36', secundario = '#f4f6fb', crestSeed = 0 }) {
  const c1 = primario;
  const c2 = sombra(primario, -0.42);
  const texto = contrasteTexto(primario);
  const banda = BANDAS[((Number(crestSeed) % 3) + 3) % 3]();
  const id = `gd-${String(codigo).replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'escudo'}`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256" role="img" aria-label="${escaparXml(`Escudo de ${nombre}`)}">`,
    `<title>${escaparXml(nombre)}</title>`,
    '<defs>',
    `<radialGradient id="${id}-fondo" cx="32%" cy="28%" r="82%">`,
    `<stop offset="0" stop-color="${c1}"/>`,
    `<stop offset="1" stop-color="${c2}"/>`,
    '</radialGradient>',
    `<clipPath id="${id}-disco"><circle cx="50" cy="50" r="49.5"/></clipPath>`,
    `<filter id="${id}-sombra" x="-20%" y="-20%" width="140%" height="140%">`,
    '<feDropShadow dx="0" dy="1.8" stdDeviation="1.6" flood-color="#000000" flood-opacity="0.55"/>',
    '</filter>',
    '</defs>',
    `<circle cx="50" cy="50" r="49.5" fill="url(#${id}-fondo)"/>`,
    `<g clip-path="url(#${id}-disco)" fill="${secundario}" fill-opacity="0.42">${banda}</g>`,
    '<circle cx="50" cy="50" r="49" fill="none" stroke="#f4f6fb" stroke-opacity="0.14" stroke-width="1"/>',
    `<text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="28" font-weight="900" letter-spacing="0.9" fill="${texto}" filter="url(#${id}-sombra)">${escaparXml(codigo)}</text>`,
    '</svg>',
    '',
  ].join('\n');
}
