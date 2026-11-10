/**
 * Utilidades de color, portadas TAL CUAL de src/utils/color.js del monolito.
 *
 * Lo importante es contrasteTexto (getContrastText): hardcodear texto blanco
 * sobre el color de un equipo deja las iniciales invisibles en los equipos
 * de color claro (Real Madrid, River, Junior). El color se calcula.
 */

export function hexARgb(hex) {
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
export function luminancia(hex) {
  const { r, g, b } = hexARgb(hex);
  const canal = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/**
 * Color de texto legible sobre `fondo`.
 * Umbral 0.45: sobre navy queremos marfil, sobre dorado/blanco queremos navy.
 */
export function contrasteTexto(fondo, oscuro = '#050B18', claro = '#F4F6FB') {
  return luminancia(fondo) > 0.45 ? oscuro : claro;
}

const limitar255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const aHex = (v) => limitar255(v).toString(16).padStart(2, '0');

/**
 * Aclara (cantidad > 0) u oscurece (cantidad < 0) un color.
 * sombra('#123a8f', -0.42) -> el mismo azul, mas profundo.
 */
export function sombra(hex, cantidad = 0) {
  const { r, g, b } = hexARgb(hex);
  const mezclar = (c) => (cantidad >= 0 ? c + (255 - c) * cantidad : c * (1 + cantidad));
  return `#${aHex(mezclar(r))}${aHex(mezclar(g))}${aHex(mezclar(b))}`;
}
