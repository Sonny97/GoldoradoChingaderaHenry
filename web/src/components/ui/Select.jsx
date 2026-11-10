import { useId } from 'react';
import Icon from './icons';

/**
 * Select nativo estilizado. El popup se renderiza oscuro gracias a
 * `color-scheme: dark` en :root; sin eso saldria blanco sobre la pagina navy.
 */
export default function Select({
  label,
  name,
  value,
  onChange,
  onBlur,
  options = [],
  placeholder = 'Selecciona…',
  error = '',
  icon = null,
  required = false,
  className = '',
  ...rest
}) {
  const reactId = useId();
  const selectId = `${name || 'select'}-${reactId}`;
  const errorId = `${selectId}-error`;

  return (
    <div className={`gd-field ${error ? 'is-invalid' : ''} ${className}`.trim()}>
      {label ? (
        <label className="gd-field__label" htmlFor={selectId}>
          {label}
          {required ? <span className="gd-field__req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}

      <div className="gd-field__control">
        {icon ? <span className="gd-field__icon">{icon}</span> : null}

        <select
          id={selectId}
          name={name}
          className="gd-field__select"
          value={value ?? ''}
          onChange={onChange}
          onBlur={onBlur}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <Icon.ChevronDown size={18} className="gd-field__caret" />
      </div>

      {error ? (
        <p className="gd-field__error" id={errorId} role="alert">
          <Icon.Alert size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
