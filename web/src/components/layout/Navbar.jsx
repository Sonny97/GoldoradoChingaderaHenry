import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Wordmark from './Wordmark';
import UserMenu from './UserMenu';
import Button from '../ui/Button';
import { ROUTES } from '../../utils/constants';

/**
 * Barra superior pegajosa.
 *
 * Los enlaces de seccion son <button> con scroll a un ancla, NO <Link>:
 * /partidos y /ligas no existen como rutas, y un <Link to="/partidos">
 * llevaria al 404. Cuando esas rutas existan, se cambia este array.
 */
const SECTIONS = [
  { id: 'partidos', label: 'Partidos' },
  { id: 'categorias', label: 'Categorías' },
  { id: 'promos', label: 'Promos' },
  { id: 'contacto', label: 'Contacto' },
];

export default function Navbar() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 12);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Cierra el menu movil al navegar y restaura el scroll del body.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function goToSection(id) {
    setOpen(false);
    const home = user ? ROUTES.DASHBOARD : ROUTES.HOME;

    if (location.pathname !== home) {
      navigate(home);
      // Espera al montaje de la nueva pagina antes de buscar el ancla.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      return;
    }

    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <header
      className={`gd-navbar ${scrolled ? 'is-scrolled' : ''} ${open ? 'is-open' : ''}`}
    >
      <div className="gd-navbar__inner gd-container">
        <Wordmark
          as={Link}
          to={user ? ROUTES.DASHBOARD : ROUTES.HOME}
          size="md"
          withMark
          shimmer
        />

        <button
          type="button"
          className="gd-navbar__burger"
          aria-expanded={open}
          aria-controls="gd-nav-menu"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav id="gd-nav-menu" className="gd-navbar__nav" aria-label="Principal">
          <ul className="gd-navbar__links">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <button type="button" onClick={() => goToSection(section.id)}>
                  {section.label}
                </button>
              </li>
            ))}
          </ul>

          <div className="gd-navbar__actions">
            {user ? (
              <UserMenu onNavigate={() => setOpen(false)} />
            ) : (
              <>
                <Button as={Link} to={ROUTES.LOGIN} variant="ghost" size="sm">
                  Iniciar sesión
                </Button>
                <Button as={Link} to={ROUTES.REGISTER} variant="gold" size="sm">
                  Registrarse
                </Button>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
