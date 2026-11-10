import { Link } from 'react-router-dom';
import Button from '../ui/Button';
import Icon from '../ui/icons';
import { ROUTES } from '../../utils/constants';

/**
 * Paso 4: confirmacion.
 *
 * El boceto termina en "Obtener", pero devolver al usuario a /login sin
 * confirmar que la contraseña cambio se siente incompleto y genera tickets de
 * soporte. Cuesta diez lineas.
 */
export default function RecoverDoneStep() {
  return (
    <div className="gd-recover__done">
      <span className="gd-recover__done-icon">
        <Icon.Check size={34} />
      </span>

      <p className="gd-auth-card__sub" style={{ margin: 0 }}>
        Ya puedes ingresar con tu nueva contraseña.
      </p>

      <Button as={Link} to={ROUTES.LOGIN} variant="gold" size="lg" full>
        Ir a iniciar sesión
      </Button>
    </div>
  );
}
