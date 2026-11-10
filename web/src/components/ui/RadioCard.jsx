/**
 * Fila seleccionable grande. La usa la pantalla de recuperacion para elegir
 * entre correo y SMS.
 *
 * Es un <button role="radio"> y no un <input type="radio"> envuelto: toda la
 * fila debe ser clicable y la marca es puramente visual. role/aria-checked
 * mantienen la semantica para lectores de pantalla, y el contenedor lleva
 * role="radiogroup".
 */
export default function RadioCard({
  selected = false,
  onSelect,
  icon = null,
  title,
  description,
  disabled = false,
  className = '',
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`gd-radio-card ${selected ? 'is-selected' : ''} ${className}`.trim()}
    >
      {icon ? <span className="gd-radio-card__icon">{icon}</span> : null}

      <span className="gd-radio-card__body">
        <span className="gd-radio-card__title">{title}</span>
        {description ? (
          <span className="gd-radio-card__desc">{description}</span>
        ) : null}
      </span>

      <span className="gd-radio-card__mark" aria-hidden="true" />
    </button>
  );
}
