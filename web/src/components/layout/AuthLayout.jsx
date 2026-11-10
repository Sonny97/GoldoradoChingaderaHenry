import { Link } from 'react-router-dom';
import Icon from '../ui/icons';
import { ROUTES } from '../../utils/constants';

/**
 * Escenario compartido por login, registro y recuperacion: resplandor
 * ambiental, enlace de vuelta al inicio y la tarjeta centrada.
 */
export default function AuthLayout({ wide = false, children }) {
  return (
    <div className={`gd-auth ${wide ? 'gd-auth--wide' : ''}`}>
      <div className="gd-auth__glow" aria-hidden="true" />

      <Link to={ROUTES.HOME} className="gd-auth__back">
        <Icon.ArrowLeft size={16} />
        Volver al inicio
      </Link>

      <div className="gd-auth__stage">{children}</div>
    </div>
  );
}
