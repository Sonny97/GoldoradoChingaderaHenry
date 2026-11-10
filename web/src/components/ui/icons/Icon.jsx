/**
 * Base de todos los iconos.
 *
 * Una sola rejilla de 24, un solo grosor de trazo, un solo linecap. Ese es el
 * argumento para dibujarlos a mano en vez de instalar react-icons: ese paquete
 * mezcla ~30 sets en rejillas y metaforas distintas, y el desajuste de peso
 * optico entre unos y otros es justo lo que hace que una pagina se vea
 * ensamblada en vez de diseñada.
 *
 * stroke="currentColor" hace que cada icono herede dorado/navy/muted desde CSS
 * sin pasar una sola prop.
 */
export default function Icon({
  size = 20,
  stroke = 1.75,
  title,
  filled = false,
  viewBox = '0 0 24 24',
  className = '',
  children,
  ...rest
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`gd-icon ${className}`.trim()}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
