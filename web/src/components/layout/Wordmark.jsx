import { useId } from 'react';

/**
 * Marca GolDorado, 100% SVG + CSS. Cero archivos de imagen.
 *
 * GOL en peso black + marfil, DORADO en semibold + degradado dorado. La
 * inflexion de peso es deliberada: el dorado en peso pesado y tamaño grande
 * se enloda sobre navy; en semibold se lee como lamina preciosa en vez de
 * grito, y el escalon crea jerarquia sin trucos de color.
 */
export function LogoMark({ size = 40, className = '' }) {
  // useId POR INSTANCIA es obligatorio, no cosmetico. El id de un
  // <linearGradient> es global al documento: si el nav, el footer y la
  // tarjeta de login usaran id="gd" fijo, los tres resolverian a la PRIMERA
  // definicion, y al desmontarse esa instancia en un cambio de ruta las otras
  // dos perderian el relleno y se pondrian negras.
  const gradId = `gd-grad-${useId().replace(/:/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`gd-logo-mark ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7e9b8" />
          <stop offset=".45" stopColor="#e7c566" />
          <stop offset="1" stopColor="#a8851a" />
        </linearGradient>
      </defs>

      <circle cx="24" cy="24" r="22.6" fill="#0a1226" />
      <circle cx="24" cy="24" r="22.6" fill="none" stroke={`url(#${gradId})`} strokeWidth="2.4" />
      <circle cx="24" cy="24" r="18.6" fill="none" stroke="#f4f6fb" strokeOpacity=".1" strokeWidth="1" />

      {/* Pentagono central del balon */}
      <path d="M24 14.6 32 20.4l-3.05 9.4h-9.9L16 20.4 24 14.6Z" fill={`url(#${gradId})`} />

      {/* Radios */}
      <path
        d="M24 6.4v8.2M40.2 18.6l-8.2 1.8M35.4 39.6l-6.45-9.8M12.6 39.6l6.45-9.8M7.8 18.6l8.2 1.8"
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity=".85"
      />
    </svg>
  );
}

export default function Wordmark({
  as: Component = 'span',
  size = 'md',
  withMark = false,
  stacked = false,
  shimmer = false,
  className = '',
  ...rest
}) {
  const markSize = size === 'lg' ? 56 : size === 'sm' ? 28 : 36;

  return (
    <Component
      className={`gd-wordmark gd-wordmark--${size} ${stacked ? 'gd-wordmark--stacked' : ''} ${className}`.trim()}
      aria-label="GolDorado"
      {...rest}
    >
      {withMark ? <LogoMark size={markSize} /> : null}
      <span className="gd-wordmark__text" aria-hidden="true">
        <span className="gd-wordmark__gol">GOL</span>
        <span className={`gd-wordmark__gold ${shimmer ? 'is-shimmer' : ''}`}>DORADO</span>
      </span>
    </Component>
  );
}
