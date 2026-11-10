import { Link, useLocation } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import RegisterForm from '../components/auth/RegisterForm';
import SocialLogin from '../components/auth/SocialLogin';
import Card from '../components/ui/Card';
import Divider from '../components/ui/Divider';
import Wordmark, { LogoMark } from '../components/layout/Wordmark';
import { ROUTES } from '../utils/constants';

export default function RegisterPage() {
  const location = useLocation();
  const from = location.state?.from?.pathname;

  return (
    <AuthLayout wide>
      <Card className="gd-auth-card" padding="lg" gold>
        <header className="gd-register__head">
          <LogoMark size={44} />
          <Wordmark size="sm" />
        </header>

        <Divider gold />

        <h1 className="gd-auth-card__title">Crear cuenta</h1>
        <p className="gd-auth-card__sub">Completa tus datos para empezar a jugar</p>

        <RegisterForm />

        <Divider label="o" />

        {/* Con Google o Microsoft la cuenta se crea sin contraseña y despues
            se pide la ficha en /completar-perfil. */}
        <SocialLogin from={from} />

        <Divider />

        <p className="gd-auth-card__foot">
          ¿Ya tienes cuenta?{' '}
          <Link className="gd-link-gold" to={ROUTES.LOGIN}>
            Inicia sesión
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
