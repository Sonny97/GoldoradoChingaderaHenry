import { useState, useCallback } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthLayout from '../components/layout/AuthLayout';
import CompleteProfileForm from '../components/auth/CompleteProfileForm';
import Card from '../components/ui/Card';
import Divider from '../components/ui/Divider';
import Alert from '../components/ui/Alert';
import Wordmark, { LogoMark } from '../components/layout/Wordmark';
import { ROUTES } from '../utils/constants';

/**
 * /completar-perfil. Mismo armazon que RegisterPage (AuthLayout ancho, tarjeta
 * dorada, wordmark) para que se lea como "el ultimo paso del registro" y no
 * como una pantalla aparte.
 *
 * "Ya estaba completo" se decide UNA vez, al montar. Si se evaluara en cada
 * render, al guardar la ficha user.profileComplete pasaria a true y el
 * <Navigate> de abajo competiria con el navigate() de onDone hacia el destino
 * que el usuario queria.
 */
export default function CompleteProfilePage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [alreadyComplete] = useState(() => user?.profileComplete !== false);

  const from = location.state?.from?.pathname;
  const destino = from && from !== ROUTES.COMPLETE_PROFILE ? from : ROUTES.DASHBOARD;

  const handleDone = useCallback(() => navigate(destino, { replace: true }), [navigate, destino]);

  if (alreadyComplete) return <Navigate to={destino} replace />;

  return (
    <AuthLayout wide>
      <Card className="gd-auth-card" padding="lg" gold>
        <header className="gd-register__head">
          <LogoMark size={44} />
          <Wordmark size="sm" />
        </header>

        <Divider gold />

        <h1 className="gd-auth-card__title">Completa tu perfil</h1>
        <p className="gd-auth-card__sub">
          {location.state?.nuevo ? '¡Bienvenido a GolDorado! ' : ''}
          Necesitamos unos datos más para que puedas recargar y apostar.
        </p>

        {user?.email ? (
          <Alert variant="info" className="gd-complete__email">
            Entraste como <strong>{user.email}</strong>. Ese seguirá siendo tu correo de acceso.
          </Alert>
        ) : null}

        <CompleteProfileForm onDone={handleDone} />
      </Card>
    </AuthLayout>
  );
}
