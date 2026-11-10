import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import Card from '../components/ui/Card';
import StepIndicator from '../components/ui/StepIndicator';
import { LogoMark } from '../components/layout/Wordmark';
import RecoverMethodStep from '../components/auth/RecoverMethodStep';
import RecoverOtpStep from '../components/auth/RecoverOtpStep';
import RecoverPasswordStep from '../components/auth/RecoverPasswordStep';
import RecoverDoneStep from '../components/auth/RecoverDoneStep';
import { useCountdown } from '../hooks/useCountdown';
import * as authService from '../services/authService';
import { ROUTES, OTP_RESEND_SECONDS } from '../utils/constants';

/**
 * Maquina de 4 pasos de recuperacion de contraseña.
 *
 * ESTA PAGINA ES DUEÑA DE TODO EL ESTADO. Los cuatro componentes de paso son
 * controlados y no guardan nada del flujo, asi la maquina es auditable de una
 * sola lectura en un archivo.
 *
 *   method-select -> otp -> new-password -> done
 */

const STEPS = ['Verificación', 'Código', 'Nueva clave'];
const STEP_INDEX = { 'method-select': 0, otp: 1, 'new-password': 2, done: 2 };
const TITLES = {
  'method-select': 'Necesitamos verificar su identidad',
  otp: 'Ingresa el código',
  'new-password': 'Crea tu nueva contraseña',
  done: 'Contraseña actualizada',
};

export default function RecoverPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState('method-select');
  const [username, setUsername] = useState(location.state?.username ?? '');
  const [account, setAccount] = useState(null);
  const [method, setMethod] = useState('email');
  const [destination, setDestination] = useState('');
  const [token, setToken] = useState(null);
  const [resetToken, setResetToken] = useState(null);
  const [devCode, setDevCode] = useState(null);
  const [code, setCode] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [identifying, setIdentifying] = useState(false);

  const resend = useCountdown(0);
  const headingRef = useRef(null);

  /* --------------------------------------------------- identificar cuenta */

  const identify = useCallback(async (value) => {
    const name = String(value ?? '').trim();
    if (!name) return null;

    setIdentifying(true);
    setError('');

    const res = await authService.lookupAccount(name);
    setIdentifying(false);

    if (!res.success) {
      setAccount(null);
      setError(res.message);
      return null;
    }

    setAccount(res.data);
    // Preselecciona un metodo disponible.
    setMethod(res.data.hasEmail ? 'email' : 'sms');
    return res.data;
  }, []);

  // Si el login nos paso el usuario, resolvemos los destinos enmascarados de
  // inmediato para que la primera pantalla salga igual que el boceto.
  useEffect(() => {
    const initial = location.state?.username;
    if (initial) identify(initial);
    // Solo al montar: si dependiera de `username`, cada tecla dispararia una
    // consulta al servicio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------ acciones */

  async function requestCode() {
    setBusy(true);
    setError('');

    const res = await authService.requestRecoveryCode({ username, method });
    setBusy(false);

    if (!res.success) {
      setError(res.message);
      return;
    }

    setToken(res.data.token);
    setDestination(res.data.destinationMasked);
    setDevCode(res.data.devCode ?? null);
    setCode('');
    resend.start(OTP_RESEND_SECONDS);
    setStep('otp');
  }

  async function verifyCode(value) {
    const entered = String(value ?? code);
    if (entered.length < 6 || busy) return;

    setBusy(true);
    setError('');

    const res = await authService.verifyRecoveryCode({ token, code: entered });
    setBusy(false);

    if (!res.success) {
      setError(res.message);
      setCode('');
      // El servicio marca tokenDead cuando el token expiro o se agotaron los
      // intentos. Sin esto el usuario seguiria tecleando en algo que ya
      // rechaza todo, sin ninguna explicacion.
      if (res.data?.tokenDead) {
        setToken(null);
        setDevCode(null);
        resend.stop();
        setStep('method-select');
      }
      return;
    }

    setResetToken(res.data.resetToken);
    setStep('new-password');
  }

  async function savePassword(password) {
    setError('');
    const res = await authService.resetPassword({ resetToken, password });

    if (res.success) {
      setStep('done');
      return res;
    }

    setError(res.message);
    return res;
  }

  /** Cancelar retrocede un paso; en el primero sale a /login. */
  function handleCancel() {
    setError('');
    switch (step) {
      case 'method-select':
        navigate(ROUTES.LOGIN);
        break;
      case 'otp':
        setToken(null);
        setDevCode(null);
        setCode('');
        resend.stop();
        setStep('method-select');
        break;
      case 'new-password':
        setResetToken(null);
        setStep('otp');
        break;
      default:
        navigate(ROUTES.LOGIN, { replace: true });
    }
  }

  /* --------------------------------------------------------- efectos UI */

  // Auto-reparacion: si el estado se desincroniza, vuelve a un paso valido en
  // vez de dejar una pantalla en blanco de la que no se puede salir.
  useEffect(() => {
    if (step === 'otp' && !token) setStep('method-select');
    if (step === 'new-password' && !resetToken) setStep('otp');
  }, [step, token, resetToken]);

  // Mueve el foco al titulo en cada cambio de paso. Sin esto, un usuario de
  // teclado o lector de pantalla se queda con el foco en un boton desmontado
  // y no se entera de que la pantalla cambio.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  /* ------------------------------------------------------------- render */

  return (
    <AuthLayout>
      <Card className="gd-auth-card" padding="lg" gold>
        <div className="gd-auth-card__avatar">
          <LogoMark size={46} />
        </div>

        <StepIndicator steps={STEPS} current={STEP_INDEX[step]} />

        <h1 className="gd-auth-card__title" tabIndex={-1} ref={headingRef}>
          {TITLES[step]}
        </h1>

        {step === 'method-select' ? (
          <RecoverMethodStep
            username={username}
            onUsernameChange={setUsername}
            account={account}
            onIdentify={() => identify(username)}
            method={method}
            onMethodChange={setMethod}
            onSubmit={requestCode}
            onCancel={handleCancel}
            busy={busy}
            identifying={identifying}
            error={error}
          />
        ) : null}

        {step === 'otp' ? (
          <RecoverOtpStep
            code={code}
            onCodeChange={(v) => {
              setCode(v);
              if (error) setError('');
            }}
            destination={destination}
            devCode={devCode}
            onVerify={verifyCode}
            onResend={requestCode}
            onCancel={handleCancel}
            busy={busy}
            resendSeconds={resend.seconds}
            error={error}
          />
        ) : null}

        {step === 'new-password' ? (
          <RecoverPasswordStep onSave={savePassword} onCancel={handleCancel} error={error} />
        ) : null}

        {step === 'done' ? <RecoverDoneStep /> : null}
      </Card>
    </AuthLayout>
  );
}
