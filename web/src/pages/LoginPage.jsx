import { Link, useLocation } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import LoginForm from '../components/auth/LoginForm';
import SocialLogin from '../components/auth/SocialLogin';
import Card from '../components/ui/Card';
import Divider from '../components/ui/Divider';
import Alert from '../components/ui/Alert';
import { LogoMark } from '../components/layout/Wordmark';
import { ROUTES, DEMO_CREDENTIALS } from '../utils/constants';

/**
 * `from` es la ruta que ProtectedRoute (o el boleto de apuesta) dejo en el
 * state al desviar aqui. El formulario normal no lo necesita, porque GuestRoute
 * ya lo lee; la entrada con Google/Microsoft si, porque sale de la aplicacion y
 * el state del router no sobrevive a esa ida y vuelta.
 */
export default function LoginPage() {
  const location = useLocation();
  const from = location.state?.from?.pathname;

  return (
    <AuthLayout>
      <Card className="gd-auth-card" padding="lg" gold>
        <div className="gd-auth-card__avatar">
          <LogoMark size={52} />
        </div>

        <h1 className="gd-auth-card__title">Iniciar sesión</h1>
        <p className="gd-auth-card__sub">Ingresa a tu cuenta GolDorado</p>

        {location.state?.aviso ? <Alert variant="gold">{location.state.aviso}</Alert> : null}

        {/* Solo en desarrollo: en build de produccion este bloque desaparece. */}
        {import.meta.env.DEV ? (
          <div className="gd-demo-hint">
            <span className="gd-demo-hint__title">Cuenta de prueba</span>
            <span>
              Usuario <code>{DEMO_CREDENTIALS.username}</code>
            </span>
            <span>
              Contraseña <code>{DEMO_CREDENTIALS.password}</code>
            </span>
          </div>
        ) : null}

        <LoginForm />

        <Divider label="o" />

        <SocialLogin from={from} />

        <p className="gd-auth-card__foot">
          ¿No tienes cuenta?{' '}
          <Link className="gd-link-gold" to={ROUTES.REGISTER}>
            Regístrate
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
