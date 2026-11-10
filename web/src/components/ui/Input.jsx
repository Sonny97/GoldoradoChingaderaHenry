import { useId } from 'react';
import Icon from './icons';

/**
 * Campo de texto.
 *
 * Detalles que no son opcionales:
 * - `name` SIEMPRE llega al nodo DOM. Sin el, useForm nunca actualiza values
 *   y todo parece cableado correctamente.
 * - `value={value ?? ''}` siempre: un solo undefined dispara el warning de
 *   "uncontrolled to controlled" y pierde la posicion del cursor.
 * - useId() para htmlFor/aria-describedby: los ids hardcodeados colisionan
 *   cuando dos formularios comparten pagina.
 * - `sanitize="digits"` viaja como data-attribute y lo aplica useForm; asi
 *   telefono y documento usan type="text" inputMode="numeric" en vez de
 *   type="number", que acepta 'e'/'+'/'-', come ceros a la izquierda y
 *   cambia de valor con la rueda del mouse.
 */
export default function Input({
  label,
  name,
  type = 'text',
  value,
  onChange,
  onBlur,
  error = '',
  hint = '',
  icon = null,
  adornment = null,
  required = false,
  sanitize = null,
  className = '',
  ...rest
}) {
  const reactId = useId();
  const inputId = `${name || 'field'}-${reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`gd-field ${error ? 'is-invalid' : ''} ${className}`.trim()}>
      {label ? (
        <label className="gd-field__label" htmlFor={inputId}>
          {label}
          {required ? <span className="gd-field__req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}

      <div className="gd-field__control">
        {icon ? <span className="gd-field__icon">{icon}</span> : null}

        <input
          id={inputId}
          name={name}
          type={type}
          className="gd-field__input"
          value={value ?? ''}
          onChange={onChange}
          onBlur={onBlur}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          data-sanitize={sanitize || undefined}
          {...rest}
        />

        {adornment ? <span className="gd-field__adornment">{adornment}</span> : null}
      </div>

      {error ? (
        <p className="gd-field__error" id={errorId} role="alert">
          <Icon.Alert size={14} />
          {error}
        </p>
      ) : null}

      {!error && hint ? (
        <p className="gd-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
