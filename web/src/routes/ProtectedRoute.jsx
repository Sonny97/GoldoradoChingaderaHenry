import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Spinner from '../components/ui/Spinner';

/**
 * Guard de rutas privadas.
 *
 * CRITICO: mientras la sesion se esta rehidratando renderiza un loader y
 * NUNCA un <Navigate>. Si "cayera" a la rama del redirect, un usuario
 * logueado que refresca /inicio saldria expulsado a /login y volveria en
 * cuanto el efecto restaura la sesion: doble parpadeo visible.
 *
 * `replace` no es opcional: sin el, el usuario rebotado presiona Atras, cae
 * en la pagina que lo reboto, y lo rebota otra vez.
 */
export default function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="gd-route-loading">
        <Spinner size={40} label="Verificando sesión" />
        <p className="gd-route-loading__text">Verificando sesión…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
