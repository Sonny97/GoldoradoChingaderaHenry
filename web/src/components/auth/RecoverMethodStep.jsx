import Input from '../ui/Input';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import RadioCard from '../ui/RadioCard';
import Icon from '../ui/icons';

/**
 * Paso 1: "Necesitamos verificar su identidad".
 *
 * El boceto ya muestra ****@hotmail.com, o sea que la app sabe quien eres. El
 * enlace del login trae el usuario tecleado en location.state. Si alguien
 * entra directo a /recuperar, este MISMO paso muestra un campo para
 * identificarse encima de los radios: sin pantalla extra y sin callejon sin
 * salida.
 */
export default function RecoverMethodStep({
  username,
  onUsernameChange,
  account,
  onIdentify,
  method,
  onMethodChange,
  onSubmit,
  onCancel,
  busy = false,
  identifying = false,
  error = '',
}) {
  const needsIdentify = !account;

  return (
    <>
      <p className="gd-auth-card__sub">
        {needsIdentify
          ? 'Ingresa tu correo o documento para enviarte el código de seguridad.'
          : '¿Cómo te gustaría obtener el código de seguridad?'}
      </p>

      {needsIdentify ? (
        <form
          className="gd-recover__identify"
          onSubmit={(event) => {
            event.preventDefault();
            onIdentify();
          }}
        >
          <Input
            label="Correo o documento"
            name="username"
            autoComplete="username"
            icon={<Icon.User size={20} />}
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
          />

          {error ? <Alert variant="error">{error}</Alert> : null}

          <div className="gd-recover__actions">
            <Button variant="outline" size="lg" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="gold"
              size="lg"
              loading={identifying}
              disabled={!username.trim()}
            >
              Continuar
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div
            className="gd-recover__options"
            role="radiogroup"
            aria-label="Método de verificación"
          >
            <RadioCard
              selected={method === 'email'}
              onSelect={() => onMethodChange('email')}
              disabled={!account.hasEmail}
              icon={<Icon.Mail size={22} />}
              title="Correo electrónico"
              description={account.emailMasked}
            />
            <RadioCard
              selected={method === 'sms'}
              onSelect={() => onMethodChange('sms')}
              disabled={!account.hasSms}
              icon={<Icon.Phone size={22} />}
              title="Mensaje de texto (SMS)"
              description={account.phoneMasked}
            />
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}

          <div className="gd-recover__actions">
            <Button variant="outline" size="lg" onClick={onCancel}>
              Cancelar
            </Button>
            <Button
              variant="gold"
              size="lg"
              loading={busy}
              disabled={!method}
              onClick={onSubmit}
            >
              Obtener
            </Button>
          </div>
        </>
      )}
    </>
  );
}
