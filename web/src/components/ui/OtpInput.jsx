import { useRef } from 'react';

/**
 * Codigo de 6 casillas.
 *
 * Soporta pegado desde el portapapeles, retroceso a la casilla anterior y
 * flechas. autoComplete="one-time-code" solo en la primera casilla, que es lo
 * que hace que iOS ofrezca el codigo del SMS.
 */
export default function OtpInput({
  length = 6,
  value = '',
  onChange,
  onComplete,
  error = '',
  label = 'Código de verificación',
  disabled = false,
}) {
  const refs = useRef([]);
  const chars = value.padEnd(length, ' ').slice(0, length).split('');

  function commit(next) {
    const clean = String(next).replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  }

  function setAt(index, char) {
    const arr = value.padEnd(length, ' ').split('');
    arr[index] = char || ' ';
    commit(arr.join('').replace(/ /g, ''));
    if (char && index < length - 1) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index) {
    return (event) => {
      if (event.key === 'Backspace' && !chars[index].trim() && index > 0) {
        event.preventDefault();
        refs.current[index - 1]?.focus();
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        refs.current[index - 1]?.focus();
      }
      if (event.key === 'ArrowRight' && index < length - 1) {
        event.preventDefault();
        refs.current[index + 1]?.focus();
      }
    };
  }

  function handlePaste(event) {
    event.preventDefault();
    const digits = (event.clipboardData.getData('text') || '')
      .replace(/\D/g, '')
      .slice(0, length);
    commit(digits);
    refs.current[Math.min(digits.length, length - 1)]?.focus();
  }

  return (
    <div className={`gd-otp-wrap ${error ? 'is-invalid' : ''}`}>
      <span className="gd-sr-only" id="gd-otp-label">
        {label}
      </span>

      <div
        className="gd-otp"
        style={{ '--gd-otp-len': length }}
        role="group"
        aria-labelledby="gd-otp-label"
        onPaste={handlePaste}
      >
        {chars.map((char, index) => (
          <input
            // El indice es una clave legitima aqui: la lista tiene largo fijo
            // y sus elementos nunca se reordenan ni se filtran.
            key={index}
            ref={(el) => {
              refs.current[index] = el;
            }}
            className={`gd-otp__box ${char.trim() ? 'is-filled' : ''}`}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={char.trim()}
            disabled={disabled}
            aria-label={`Dígito ${index + 1}`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setAt(index, e.target.value.replace(/\D/g, '').slice(-1))}
            onKeyDown={handleKeyDown(index)}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>

      {error ? (
        <p className="gd-otp__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
