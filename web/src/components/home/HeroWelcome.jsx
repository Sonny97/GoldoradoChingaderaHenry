import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/icons';
import DepositModal from '../wallet/DepositModal';
import { formatBalance } from '../../utils/format';
import { ROUTES } from '../../utils/constants';

/**
 * Hero de /inicio: el "Welcome {user}" del boceto, en español.
 *
 * "Recargar" dejo de ser un boton apagado: abre el DepositModal aqui mismo, sin
 * sacar al usuario del panel. Si a la cuenta le falta la ficha (entro con
 * Google o Microsoft), ms-pagos rechazaria el pago con 403, asi que el boton
 * lleva primero a completar el perfil en vez de dejarlo estrellarse.
 *
 * Un saldo null significa que ms-apuestas no respondio: se pinta "—" y no
 * "$ 0", que el usuario leeria como "perdi mi plata".
 */
export default function HeroWelcome({ user }) {
  // Hooks antes del return temprano: mismo orden en cada render.
  const [depositOpen, setDepositOpen] = useState(false);
  const closeDeposit = useCallback(() => setDepositOpen(false), []);

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  // El admin de la semilla no tiene ficha, pero tampoco apuesta: a el no se
  // le pide completar el perfil, se le lleva al panel.
  const profileComplete = user.profileComplete !== false;
  const hasBalance = typeof user.balance === 'number';

  return (
    <section className="gd-welcome">
      <div className="gd-welcome__inner gd-container">
        <span className="gd-eyebrow">
          <span className="gd-eyebrow__dot" />
          Tu panel
        </span>

        <h1 className="gd-welcome__title">
          Bienvenido, <span className="gd-text-gold">{user.name}</span>
        </h1>

        <p className="gd-welcome__sub">
          {!hasBalance
            ? 'No pudimos consultar tu saldo en este momento.'
            : `Tienes un bono sin reclamar y ${user.balance > 0 ? 'saldo listo para jugar' : 'una recarga pendiente'}.`}
        </p>

        {isAdmin ? (
          <Alert variant="gold" className="gd-welcome__cta">
            <strong>Cuenta de administrador.</strong> Actualiza marcadores y liquida apuestas desde el{' '}
            <Link className="gd-link-gold" to={ROUTES.ADMIN}>
              Panel de administración
            </Link>
            .
          </Alert>
        ) : !profileComplete ? (
          <Alert variant="gold" className="gd-welcome__cta">
            <strong>Completa tu perfil para apostar y recargar.</strong>{' '}
            Solo te faltan tu documento, tu teléfono y tu fecha de nacimiento.{' '}
            <Link className="gd-link-gold" to={ROUTES.COMPLETE_PROFILE}>
              Completar ahora
            </Link>
          </Alert>
        ) : null}

        <div className="gd-welcome__balance">
          <span className="gd-welcome__balance-label">Saldo disponible</span>
          <strong className="gd-welcome__balance-value">{formatBalance(user.balance)}</strong>
          {profileComplete ? (
            <Button
              size="sm"
              variant="outline"
              iconLeft={<Icon.Wallet size={16} />}
              onClick={() => setDepositOpen(true)}
            >
              Recargar
            </Button>
          ) : (
            <Button
              as={Link}
              to={ROUTES.COMPLETE_PROFILE}
              size="sm"
              variant="outline"
              iconLeft={<Icon.Wallet size={16} />}
            >
              Recargar
            </Button>
          )}
        </div>
      </div>

      <DepositModal open={depositOpen} onClose={closeDeposit} />
    </section>
  );
}
