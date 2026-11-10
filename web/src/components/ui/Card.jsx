/**
 * Superficie navy generica.
 *
 * `as` permite que la tarjeta sea <article> (tarjeta de partido), <aside>
 * (panel lateral) o <div>, sin duplicar estilos.
 */
export default function Card({
  as: Component = 'div',
  padding = 'md',
  gold = false,
  interactive = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    'gd-card',
    `gd-card--pad-${padding}`,
    gold && 'gd-card--gold',
    interactive && 'gd-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
