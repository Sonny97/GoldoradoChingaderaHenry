/**
 * Utilidades de color para los escudos generados y los avatares.
 *
 * El punto importante es getContrastText: hardcodear texto blanco sobre el
 * color de un equipo deja las iniciales invisibles en cualquier equipo de
 * color claro (blanco, amarillo, celeste). El color se calcula.
 */

export function hexToRgb(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
export function getLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Devuelve el color de texto legible sobre `bgHex`.
 * Umbral 0.45: sobre navy queremos marfil, sobre dorado/blanco queremos navy.
 */
export function getContrastText(bgHex, dark = '#050B18', light = '#F4F6FB') {
  return getLuminance(bgHex) > 0.45 ? dark : light;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const toHex = (v) => clamp255(v).toString(16).padStart(2, '0');

/**
 * Aclara (amount > 0) u oscurece (amount < 0) un color.
 * shade('#123a8f', -0.45) -> el mismo azul, mas profundo.
 */
export function shade(hex, amount = 0) {
  const { r, g, b } = hexToRgb(hex);
  const mix = (c) => (amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

/**
 * Tono HSL estable derivado de un string. Se usa como respaldo cuando un
 * elemento no trae color propio; mismo texto -> mismo tono siempre.
 */
export function hashHue(str) {
  let hash = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) % 360;
  }
  return hash;
}
