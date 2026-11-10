import OtpInput from '../ui/OtpInput';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/icons';

/**
 * Paso 2: codigo de 6 digitos.
 *
 * El recuadro con el codigo de demo solo aparece cuando devCode viene
 * definido, y el servicio solo lo incluye si import.meta.env.DEV. En un build
 * de produccion desaparece sin tocar una linea de codigo.
 */
export default function RecoverOtpStep({
  code,
  onCodeChange,
  destination,
  devCode,
  onVerify,
  onResend,
  onCancel,
  busy = false,
  resendSeconds = 0,
  error = '',
}) {
  return (
    <>
      <p className="gd-auth-card__sub">
        Enviamos un código de 6 dígitos a{' '}
        <strong className="gd-recover__dest">{destination}</strong>
      </p>

      {devCode ? (
        <Alert variant="gold">
          Modo demo — tu código es <strong>{devCode}</strong>
        </Alert>
      ) : null}

      <div style={{ marginTop: 'var(--gd-sp-5)' }}>
        <OtpInput
          value={code}
          onChange={onCodeChange}
          onComplete={onVerify}
          error={error}
          disabled={busy}
        />
      </div>

      <p className="gd-recover__resend">
        {resendSeconds > 0 ? (
          <>
            Puedes reenviarlo en{' '}
            <span className="gd-recover__timer">{resendSeconds}s</span>
          </>
        ) : (
          <button type="button" className="gd-recover__link-btn" onClick={onResend}>
            Reenviar código
          </button>
        )}
      </p>

      <div className="gd-recover__actions">
        <Button
          variant="outline"
          size="lg"
          iconLeft={<Icon.ArrowLeft size={18} />}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          variant="gold"
          size="lg"
          loading={busy}
          disabled={code.length < 6}
          onClick={() => onVerify(code)}
        >
          Verificar
        </Button>
      </div>
    </>
  );
}
