export default function Badge({
  variant = 'neutral',
  dot = false,
  className = '',
  children,
  ...rest
}) {
  return (
    <span className={`gd-badge gd-badge--${variant} ${className}`.trim()} {...rest}>
      {dot ? <span className="gd-badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
