import Spinner from './Spinner';

/**
 * Boton polimorfico.
 *
 *   <Button variant="gold" size="lg" onClick={...}>Entrar</Button>
 *   <Button as={Link} to="/registro" variant="gold">Crear cuenta</Button>
 *
 * `type` por defecto es "button" a proposito: un <button> pelado dentro de un
 * <form> es submit por defecto, que es de donde salen los bugs de "el boton
 * secundario envia el formulario". Quien quiera enviar pasa type="submit".
 */
export default function Button({
  as,
  variant = 'gold',
  size = 'md',
  full = false,
  pill = false,
  loading = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  const classes = [
    'gd-btn',
    `gd-btn--${variant}`,
    `gd-btn--${size}`,
    full && 'gd-btn--full',
    pill && 'gd-btn--pill',
    loading && 'is-loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {loading ? <Spinner size={16} label="Procesando" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </>
  );

  const Component = as || 'button';

  // <Link> y <a> no aceptan `disabled`; hay que apagarlos por otra via.
  // El spread va PRIMERO para que aria-disabled/tabIndex/onClick de abajo
  // no puedan ser pisados por rest.
  if (Component !== 'button') {
    const isInert = disabled || loading;
    return (
      <Component
        {...rest}
        className={classes}
        aria-disabled={isInert || undefined}
        tabIndex={isInert ? -1 : rest.tabIndex}
        onClick={
          isInert
            ? (event) => event.preventDefault()
            : rest.onClick
        }
      >
        {content}
      </Component>
    );
  }

  return (
    <button {...rest} type={type} className={classes} disabled={disabled || loading}>
      {content}
    </button>
  );
}
