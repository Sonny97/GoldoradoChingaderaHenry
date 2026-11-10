/**
 * Spinner de anillo. Usa currentColor, asi es navy dentro de un boton dorado
 * y dorado dentro de uno de contorno: cero variantes que mantener.
 */
export default function Spinner({ size = 24, label = 'Cargando', className = '' }) {
  return (
    <span
      className={`gd-spinner ${className}`.trim()}
      style={{ '--gd-spin-size': `${size}px` }}
      role="status"
    >
      <svg viewBox="0 0 50 50" aria-hidden="true" focusable="false">
        <circle className="gd-spinner__track" cx="25" cy="25" r="20" fill="none" strokeWidth="5" />
        <circle
          className="gd-spinner__head"
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </svg>
      <span className="gd-sr-only">{label}</span>
    </span>
  );
}
