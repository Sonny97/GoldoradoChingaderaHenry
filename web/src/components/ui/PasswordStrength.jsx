import { scorePassword, PASSWORD_LEVELS } from '../../utils/validators';

/**
 * Medidor de 4 rayas del boceto.
 *
 * La logica vive en utils/validators.js, no aqui: el mismo scorePassword lo
 * usan validateRegister y validateNewPassword. Si estuviera dentro de este
 * componente, ninguno de los dos podria alcanzarlo.
 *
 * role="meter" + aria-valuetext hace que el nivel se anuncie en voz.
 */
export default function PasswordStrength({ value = '', showLabel = true, id }) {
  const score = scorePassword(value);
  const level = PASSWORD_LEVELS[score];

  return (
    <div className={`gd-pwd gd-pwd--${score}`} id={id}>
      <div
        className="gd-pwd__bars"
        role="meter"
        aria-label="Seguridad de la contraseña"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={level}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`gd-pwd__bar ${i < score ? 'is-on' : ''}`}
            style={{ '--i': i }}
          />
        ))}
      </div>

      {showLabel ? (
        <span className="gd-pwd__label" aria-hidden="true">
          {value ? level : 'Mínimo 8 caracteres'}
        </span>
      ) : null}
    </div>
  );
}
