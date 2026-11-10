import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Spinner from '../components/ui/Spinner';
import { ROUTES } from '../utils/constants';

const AUTH_PATHS = [ROUTES.LOGIN, ROUTES.REGISTER, ROUTES.RECOVER];

/**
 * Guard de rutas solo para invitados.
 *
 * ES LA UNICA AUTORIDAD QUE NAVEGA TRAS UN LOGIN EXITOSO. Los formularios no
 * llaman navigate(): en cuanto `user` deja de ser null, este componente
 * re-renderiza y emite el <Navigate>. Si el formulario tambien navegara
 * habria dos navegaciones compitiendo en el mismo commit.
 */
export default function GuestRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="gd-route-loading">
        <Spinner size={40} label="Cargando" />
      </div>
    );
  }

  if (user) {
    // Vuelve a donde el usuario queria ir antes de que ProtectedRoute lo
    // desviara, salvo que ese origen fuera otra pantalla de autenticacion
    // (que lo devolveria aqui en bucle).
    const from = location.state?.from?.pathname;
    const target = from && !AUTH_PATHS.includes(from) ? from : ROUTES.DASHBOARD;
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
