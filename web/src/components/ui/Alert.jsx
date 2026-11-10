import Icon from './icons';

const ICONS = {
  error: Icon.Alert,
  success: Icon.CheckCircle,
  info: Icon.Info,
  gold: Icon.Info,
};

/**
 * Banner de mensaje en linea.
 *
 * role="alert" para errores (interrumpe al lector de pantalla, que es lo
 * correcto cuando un envio falla) y aria-live="polite" para el resto.
 */
export default function Alert({ variant = 'info', children, className = '', ...rest }) {
  const Glyph = ICONS[variant] ?? Icon.Info;

  return (
    <div
      className={`gd-alert gd-alert--${variant} ${className}`.trim()}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      {...rest}
    >
      <Glyph size={18} className="gd-alert__icon" />
      <div>{children}</div>
    </div>
  );
}
