import { Link } from 'react-router-dom';
import Button from '../ui/Button';
import Icon from '../ui/icons';
import { LogoMark } from '../layout/Wordmark';
import { ROUTES } from '../../utils/constants';

/**
 * Hero del home publico.
 *
 * Texto alineado a la IZQUIERDA con una etiqueta dorada encima. Centrar cada
 * bloque de la pagina es el tell de plantilla generica.
 *
 * Sin fotos: el fondo es geometria y degradados. Con cero assets eso se ve
 * mucho mejor que un JPEG de estadio mediocre.
 */
export default function Hero() {
  return (
    <section className="gd-hero">
      <div className="gd-hero__glow" aria-hidden="true" />

      <div className="gd-hero__inner gd-container">
        <div className="gd-hero__copy">
          <span className="gd-eyebrow">
            <span className="gd-eyebrow__dot" />
            Casa de apuestas deportivas
          </span>

          <h1 className="gd-hero__title">
            Donde cada gol <span className="gd-text-gold">vale oro</span>
          </h1>

          <p className="gd-hero__sub">
            Cuotas en vivo, ligas de todo el mundo y retiros al instante.
            Regístrate y llévate tu bono de bienvenida.
          </p>

          <div className="gd-hero__cta">
            <Button
              as={Link}
              to={ROUTES.REGISTER}
              size="lg"
              variant="gold"
              iconRight={<Icon.ChevronRight size={18} />}
            >
              Crear cuenta
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() =>
                document.getElementById('partidos')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              Ver partidos
            </Button>
          </div>

          <ul className="gd-hero__stats">
            <li>
              <strong>+120</strong>
              <span>Ligas</span>
            </li>
            <li>
              <strong>24/7</strong>
              <span>En vivo</span>
            </li>
            <li>
              <strong>&lt;5 min</strong>
              <span>Retiros</span>
            </li>
          </ul>
        </div>

        <div className="gd-hero__visual" aria-hidden="true">
          <LogoMark size={400} />
        </div>
      </div>
    </section>
  );
}
