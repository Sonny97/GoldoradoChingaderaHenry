import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Avatar from '../ui/Avatar';
import Icon from '../ui/icons';
import { ROUTES } from '../../utils/constants';

/**
 * Menu de cuenta del navbar.
 *
 * Mi perfil, Mis apuestas y Billetera ya tienen pantalla propia, asi que
 * dejaron de ser items apagados y son <Link> de verdad (clic medio y "abrir en
 * pestaña nueva" funcionan). Cerrar sesion sigue siendo un <button>: es una
 * accion, no un destino.
 */
const MENU_LINKS = [
  { to: ROUTES.PROFILE, label: 'Mi perfil', Glyph: Icon.User },
  { to: ROUTES.MY_BETS, label: 'Mis apuestas', Glyph: Icon.Trophy },
  { to: ROUTES.WALLET, label: 'Billetera', Glyph: Icon.Wallet },
];

export default function UserMenu({ onNavigate }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;

    function onDocMouseDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    onNavigate?.();

    // ORDEN IMPORTANTE: navegar ANTES de cerrar sesion. Al reves,
    // ProtectedRoute ve user===null todavia montado en /inicio y dispara un
    // parpadeo hacia /login antes de que aterrice este navigate.
    navigate(ROUTES.HOME, { replace: true });
    await logout();
  }

  if (!user) return null;

  return (
    <div className="gd-user-menu" ref={ref}>
      <button
        type="button"
        className="gd-user-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar user={user} size={30} />
        <span>{user.name}</span>
        <Icon.ChevronDown size={16} className="gd-user-menu__caret" />
      </button>

      {open ? (
        <div className="gd-user-menu__panel" role="menu">
          <div className="gd-user-menu__head">
            <div className="gd-user-menu__name">{user.fullName}</div>
            <div className="gd-user-menu__email">{user.email}</div>
          </div>

          {MENU_LINKS.map(({ to, label, Glyph }) => (
            <Link
              key={to}
              to={to}
              role="menuitem"
              className="gd-user-menu__link"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
            >
              <Glyph size={16} />
              {label}
            </Link>
          ))}

          <hr className="gd-user-menu__sep" />

          <button
            type="button"
            role="menuitem"
            className="gd-user-menu__logout"
            onClick={handleLogout}
          >
            <Icon.LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  );
}
