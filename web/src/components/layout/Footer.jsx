import { Link } from 'react-router-dom';
import Wordmark from './Wordmark';
import Icon from '../ui/icons';
import { ROUTES, APP_NAME, APP_TAGLINE } from '../../utils/constants';

/**
 * Pie de pagina.
 *
 * La segunda columna del boceto decia "Recovery". Una palabra suelta en
 * ingles en un pie en español se lee como descuido, asi que la columna se
 * llama "Cuenta" y "Recuperar contraseña" vive dentro.
 *
 * La franja legal 18+ no es decorativa: en un sitio de apuestas su ausencia
 * se lee como sitio sin licencia.
 */

const SOCIAL = [
  { key: 'facebook', label: 'Facebook', Glyph: Icon.Facebook },
  { key: 'instagram', label: 'Instagram', Glyph: Icon.Instagram },
  { key: 'x', label: 'X', Glyph: Icon.XTwitter },
  { key: 'youtube', label: 'YouTube', Glyph: Icon.YouTube },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="gd-footer" id="contacto">
      <div className="gd-container gd-footer__grid">
        <div className="gd-footer__brand">
          <Wordmark size="md" withMark />
          <p className="gd-footer__tagline">{APP_TAGLINE}</p>

          <ul className="gd-footer__social">
            {SOCIAL.map(({ key, label, Glyph }) => (
              <li key={key}>
                {/* Sin destino real: href="#" con preventDefault evita el
                    salto de scroll de un ancla vacia. */}
                <a
                  href="#contacto"
                  aria-label={label}
                  onClick={(e) => e.preventDefault()}
                >
                  <Glyph size={18} />
                </a>
              </li>
            ))}
          </ul>

          <span className="gd-footer__age" aria-label="Solo mayores de 18 años">
            18+
          </span>
        </div>

        <nav className="gd-footer__col" aria-label="Inicio">
          <h3 className="gd-footer__title">Inicio</h3>
          <ul>
            <li><Link to={ROUTES.HOME}>Home</Link></li>
            <li>
              <button
                type="button"
                onClick={() =>
                  document.getElementById('partidos')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Partidos
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() =>
                  document.getElementById('categorias')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                Categorías
              </button>
            </li>
          </ul>
        </nav>

        <nav className="gd-footer__col" aria-label="Cuenta">
          <h3 className="gd-footer__title">Cuenta</h3>
          <ul>
            <li><Link to={ROUTES.LOGIN}>Iniciar sesión</Link></li>
            <li><Link to={ROUTES.REGISTER}>Crear cuenta</Link></li>
            <li><Link to={ROUTES.RECOVER}>Recuperar contraseña</Link></li>
          </ul>
        </nav>

        <nav className="gd-footer__col" aria-label="Contacto">
          <h3 className="gd-footer__title">Contacto</h3>
          <ul>
            <li><a href="mailto:soporte@goldorado.co">soporte@goldorado.co</a></li>
            <li><a href="tel:+576040000000">+57 604 000 0000</a></li>
            <li><a href="https://wa.me/573000000000" target="_blank" rel="noreferrer">WhatsApp</a></li>
          </ul>
        </nav>
      </div>

      <div className="gd-footer__bar">
        <div className="gd-container gd-footer__bar-inner">
          <span>
            © {year} {APP_NAME}. Todos los derechos reservados.
          </span>
          <span className="gd-footer__legal">
            Prohibido el ingreso a menores de 18 años. Juega con responsabilidad.
          </span>
        </div>
      </div>
    </footer>
  );
}
