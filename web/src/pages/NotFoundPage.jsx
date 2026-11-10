import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Icon from '../components/ui/icons';
import { ROUTES } from '../utils/constants';

export default function NotFoundPage() {
  return (
    <div className="gd-notfound">
      <span className="gd-notfound__code">404</span>
      <h1>Fuera de juego</h1>
      <p className="gd-notfound__text">
        Esta página no existe o fue movida. Vuelve al inicio para seguir viendo
        los partidos.
      </p>
      <Button
        as={Link}
        to={ROUTES.HOME}
        variant="gold"
        size="lg"
        iconLeft={<Icon.ArrowLeft size={18} />}
      >
        Volver al inicio
      </Button>
    </div>
  );
}
