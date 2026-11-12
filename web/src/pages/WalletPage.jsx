import { useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAsync } from '../hooks/useAsync';
import * as walletService from '../services/walletService';
import * as paymentService from '../services/paymentService';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import Spinner from '../components/ui/Spinner';
import Icon from '../components/ui/icons';
import DepositModal from '../components/wallet/DepositModal';
import WithdrawModal from '../components/wallet/WithdrawModal';
import StatusBadge from '../components/wallet/StatusBadge';
import { formatBalance, formatCurrencyCOP, formatDateTime } from '../utils/format';
import { ROUTES } from '../utils/constants';

/** Etiquetas del libro de movimientos de ms-transacciones. */
const TIPOS = {
  RECARGA: 'Recarga',
  DEPOSITO: 'Recarga',
  DEPOSIT: 'Recarga',
  APUESTA: 'Apuesta',
  BET: 'Apuesta',
  PREMIO: 'Premio',
  GANANCIA: 'Premio',
  WIN: 'Premio',
  REEMBOLSO: 'Reembolso',
  REFUND: 'Reembolso',
  RETIRO: 'Retiro',
  WITHDRAWAL: 'Retiro',
  BONO: 'Bono',
  AJUSTE: 'Ajuste',
};

/** Salidas de dinero: se pintan con signo menos aunque el libro guarde el monto positivo. */
const ES_SALIDA = /apuesta|bet|retiro|withdraw|debito|debit/i;

function describeMovement(movement) {
  const type = String(movement.type ?? '').toUpperCase();
  const label = TIPOS[type] ?? (movement.type ? String(movement.type) : 'Movimiento');
  const amount = Number(movement.amount) || 0;
  const isOut = amount < 0 || ES_SALIDA.test(type);
  return { label, isOut, abs: Math.abs(amount) };
}

/**
 * /billetera: saldo, recarga, pagos de Wompi y libro de movimientos.
 *
 * Tres servicios distintos detras (ms-apuestas, ms-pagos, ms-transacciones) y
 * tres cargas independientes: si el libro de MongoDB no responde, el saldo y
 * los pagos se siguen viendo. Una sola peticion que juntara todo fallaria
 * completa por culpa del servicio mas lento.
 *
 * /billetera?recargar=1 abre el modal de recarga directamente (lo usan los
 * enlaces "Recargar" de otras pantallas).
 */
export default function WalletPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [depositOpen, setDepositOpen] = useState(() => searchParams.get('recargar') === '1');
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const fetchWallet = useCallback(() => walletService.getWallet(), []);
  const fetchPayments = useCallback(() => paymentService.listPayments({ limit: 10 }), []);
  const fetchMovements = useCallback(() => walletService.getMovements({ limit: 20 }), []);

  const wallet = useAsync(fetchWallet, [], { initialData: null });
  const payments = useAsync(fetchPayments, [], { initialData: [] });
  const movements = useAsync(fetchMovements, [], { initialData: [] });

  const closeDeposit = useCallback(() => {
    setDepositOpen(false);
    // Se quita ?recargar=1 para que un F5 no vuelva a abrir el modal.
    if (searchParams.has('recargar')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeWithdraw = useCallback(() => setWithdrawOpen(false), []);

  // Retiro hecho: saldo y libro cambian, se recargan los dos (el modal sigue
  // mostrando el comprobante hasta que el usuario lo cierre).
  const { reload: reloadWallet } = wallet;
  const { reload: reloadMovements } = movements;
  const handleWithdrawn = useCallback(() => {
    reloadWallet();
    reloadMovements();
  }, [reloadWallet, reloadMovements]);

  const profileComplete = user?.profileComplete !== false;
  // Las cuentas de administrador no juegan con dinero: el BFF les rechaza el
  // retiro con 403, asi que ni se ofrece.
  const isAdmin = user?.role === 'admin';

  // Si /billetera falla, el saldo de /auth/me es el respaldo: viene del mismo
  // ms-apuestas, solo que leido al iniciar sesion.
  const balance = wallet.data?.balance ?? user?.balance ?? null;
  const locked = wallet.data?.lockedBalance ?? user?.lockedBalance ?? null;

  return (
    <section className="gd-section gd-container gd-wallet">
      <header className="gd-page-head gd-page-head--split">
        <div>
          <span className="gd-eyebrow">
            <span className="gd-eyebrow__dot" />
            Tu dinero
          </span>
          <h1 className="gd-section__title">Billetera</h1>
        </div>

        {profileComplete ? (
          <div className="gd-wallet__actions">
            {!isAdmin ? (
              <Button
                variant="outline"
                size="lg"
                iconLeft={<Icon.Bank size={18} />}
                onClick={() => setWithdrawOpen(true)}
              >
                Retirar
              </Button>
            ) : null}
            <Button
              variant="gold"
              size="lg"
              iconLeft={<Icon.Plus size={18} />}
              onClick={() => setDepositOpen(true)}
            >
              Recargar
            </Button>
          </div>
        ) : (
          <Button as={Link} to={ROUTES.COMPLETE_PROFILE} variant="gold" size="lg">
            Completa tu perfil para recargar
          </Button>
        )}
      </header>

      <div className="gd-wallet__balances">
        <Card padding="lg" gold className="gd-balance-card gd-balance-card--main">
          <span className="gd-balance-card__label">
            <Icon.Wallet size={18} />
            Saldo disponible
          </span>
          <strong className="gd-balance-card__value">
            {wallet.isLoading && balance === null ? '…' : formatBalance(balance)}
          </strong>
          <span className="gd-balance-card__hint">Listo para apostar</span>
        </Card>

        <Card padding="lg" className="gd-balance-card">
          <span className="gd-balance-card__label">
            <Icon.Ticket size={18} />
            En apuestas
          </span>
          <strong className="gd-balance-card__value">
            {wallet.isLoading && locked === null ? '…' : formatBalance(locked)}
          </strong>
          <span className="gd-balance-card__hint">Comprometido en apuestas abiertas</span>
        </Card>
      </div>

      {wallet.error ? (
        <Alert variant="error">No pudimos actualizar tu saldo: {wallet.error}</Alert>
      ) : null}

      <div className="gd-wallet__lists">
        <Card padding="lg" className="gd-wallet__panel">
          <header className="gd-wallet__panel-head">
            <h2 className="gd-wallet__panel-title">Recargas</h2>
            <Button variant="ghost" size="sm" onClick={payments.reload} disabled={payments.isLoading}>
              Actualizar
            </Button>
          </header>

          {payments.isLoading ? (
            <div className="gd-wallet__state">
              <Spinner size={28} label="Cargando recargas" />
            </div>
          ) : payments.error ? (
            <Alert variant="error">{payments.error}</Alert>
          ) : !payments.data?.length ? (
            <p className="gd-wallet__empty">Todavía no has hecho recargas.</p>
          ) : (
            <ul className="gd-ledger">
              {payments.data.map((payment) => (
                <li key={payment.reference} className="gd-ledger__row">
                  <span className="gd-ledger__icon" aria-hidden="true">
                    {payment.method === 'PSE' ? <Icon.Bank size={18} /> : <Icon.CreditCard size={18} />}
                  </span>
                  <div className="gd-ledger__body">
                    <span className="gd-ledger__title">
                      {payment.method === 'PSE' ? 'PSE' : 'Wompi'}
                      {payment.bank ? ` · ${payment.bank}` : ''}
                    </span>
                    <span className="gd-ledger__meta">
                      {formatDateTime(payment.createdAt)} · {payment.reference}
                    </span>
                  </div>
                  <div className="gd-ledger__side">
                    <strong className="gd-ledger__amount">{formatCurrencyCOP(payment.amount)}</strong>
                    <StatusBadge status={payment.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="lg" className="gd-wallet__panel">
          <header className="gd-wallet__panel-head">
            <h2 className="gd-wallet__panel-title">Movimientos</h2>
          </header>

          {movements.isLoading ? (
            <div className="gd-wallet__state">
              <Spinner size={28} label="Cargando movimientos" />
            </div>
          ) : movements.error ? (
            <Alert variant="error">{movements.error}</Alert>
          ) : !movements.data?.length ? (
            <p className="gd-wallet__empty">Aún no hay movimientos en tu billetera.</p>
          ) : (
            <ul className="gd-ledger">
              {movements.data.map((movement, index) => {
                const { label, isOut, abs } = describeMovement(movement);
                return (
                  <li key={movement.code ?? `${movement.reference}-${index}`} className="gd-ledger__row">
                    <span
                      className={`gd-ledger__icon ${isOut ? 'gd-ledger__icon--out' : 'gd-ledger__icon--in'}`}
                      aria-hidden="true"
                    >
                      {isOut ? <Icon.Ticket size={18} /> : <Icon.Plus size={18} />}
                    </span>
                    <div className="gd-ledger__body">
                      <span className="gd-ledger__title">{label}</span>
                      <span className="gd-ledger__meta">
                        {formatDateTime(movement.createdAt)}
                        {movement.reference ? ` · ${movement.reference}` : ''}
                      </span>
                    </div>
                    <div className="gd-ledger__side">
                      <strong
                        className={`gd-ledger__amount ${isOut ? 'is-out' : 'is-in'}`}
                        aria-label={`${isOut ? 'Salida' : 'Entrada'} de ${formatCurrencyCOP(abs)}`}
                      >
                        {isOut ? '−' : '+'}
                        {formatCurrencyCOP(abs)}
                      </strong>
                      {movement.status ? <StatusBadge status={movement.status} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <DepositModal open={depositOpen && profileComplete} onClose={closeDeposit} />
      <WithdrawModal
        open={withdrawOpen && profileComplete && !isAdmin}
        onClose={closeWithdraw}
        available={balance}
        onSuccess={handleWithdrawn}
      />
    </section>
  );
}
