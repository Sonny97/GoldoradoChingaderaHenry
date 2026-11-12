import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import * as walletService from '../../services/walletService';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import RadioCard from '../ui/RadioCard';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/icons';
import { formatCurrencyCOP, formatDateTime } from '../../utils/format';
import { digitsOnly } from '../../utils/validators';
import { ACCOUNT_TYPES, MIN_WITHDRAWAL_AMOUNT, WITHDRAWAL_BANKS } from '../../utils/constants';

const BANK_OPTIONS = WITHDRAWAL_BANKS.map((name) => ({ value: name, label: name }));

/**
 * Retiro a cuenta bancaria.
 *
 * Igual que DepositModal, el formulario SOLO se monta con el modal abierto:
 * cerrarlo limpia todo y el proximo retiro arranca de cero.
 *
 * `available` es el saldo disponible que ya pinta la billetera: es el tope del
 * monto. ms-apuestas vuelve a validar con la condicion dentro del UPDATE, asi
 * que dos pestañas retirando a la vez no dejan el saldo en negativo.
 *
 * `onSuccess(result)` avisa a la pagina para que recargue saldo y movimientos.
 */
export default function WithdrawModal({ open, onClose, available, onSuccess }) {
  return (
    <Modal open={open} onClose={onClose} title="Retirar saldo">
      {open ? <WithdrawFlow available={available} onClose={onClose} onSuccess={onSuccess} /> : null}
    </Modal>
  );
}

function WithdrawFlow({ available, onClose, onSuccess }) {
  const { refreshUser } = useAuth();

  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [accountType, setAccountType] = useState(ACCOUNT_TYPES.SAVINGS);
  const [accountNumber, setAccountNumber] = useState('');

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const maxAmount = Number(available) || 0;
  const canWithdraw = maxAmount >= MIN_WITHDRAWAL_AMOUNT;

  function validate() {
    const next = {};
    const n = Number(amount);

    if (!amount) next.amount = 'Ingresa el monto a retirar';
    else if (!Number.isInteger(n)) next.amount = 'El monto debe ser un número entero';
    else if (n < MIN_WITHDRAWAL_AMOUNT) next.amount = `El monto mínimo es ${formatCurrencyCOP(MIN_WITHDRAWAL_AMOUNT)}`;
    else if (n > maxAmount) next.amount = `Solo tienes ${formatCurrencyCOP(maxAmount)} disponibles`;

    if (!bank) next.bank = 'Selecciona el banco de destino';
    if (!accountNumber) next.accountNumber = 'Ingresa el número de cuenta';
    else if (accountNumber.length < 6 || accountNumber.length > 20) {
      next.accountNumber = 'El número de cuenta debe tener entre 6 y 20 dígitos';
    }

    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setIsSubmitting(true);
    const res = await walletService.requestWithdrawal({
      amount: Number(amount),
      bank,
      accountType,
      accountNumber,
    });
    setIsSubmitting(false);

    if (!res.success || !res.data) {
      setSubmitError(res.message || 'No pudimos registrar el retiro');
      return;
    }

    setResult(res.data);
    // El saldo del navbar sale de /auth/me: se relee para que no quede viejo.
    refreshUser();
    onSuccess?.(res.data);
  }

  function clearError(name) {
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  }

  if (result) {
    return (
      <div className="gd-deposit__state gd-withdraw__done" aria-live="polite">
        <span className="gd-withdraw__done-icon" aria-hidden="true">
          <Icon.CheckCircle size={36} />
        </span>
        <p className="gd-deposit__state-title">Retiro registrado</p>
        <p className="gd-deposit__state-text">
          Enviamos {formatCurrencyCOP(result.amount)} a tu cuenta {accountType.toLowerCase()} de {bank}{' '}
          terminada en {accountNumber.slice(-4)}.
        </p>
        <dl className="gd-withdraw__summary">
          <div>
            <dt>Referencia</dt>
            <dd>{result.reference}</dd>
          </div>
          <div>
            <dt>Fecha</dt>
            <dd>{formatDateTime(result.date)}</dd>
          </div>
          <div>
            <dt>Nuevo saldo disponible</dt>
            <dd className="gd-text-gold">{formatCurrencyCOP(result.balance)}</dd>
          </div>
        </dl>
        <Button variant="gold" onClick={onClose}>
          Listo
        </Button>
      </div>
    );
  }

  return (
    <form className="gd-deposit" onSubmit={handleSubmit} noValidate>
      <Alert variant="info" className="gd-deposit__notice">
        Transferencia simulada: en esta demo no se mueve dinero real.
      </Alert>

      {!canWithdraw ? (
        <Alert variant="gold">
          Necesitas al menos {formatCurrencyCOP(MIN_WITHDRAWAL_AMOUNT)} disponibles para retirar. Las
          apuestas abiertas no se pueden retirar hasta que se liquiden.
        </Alert>
      ) : null}

      <Input
        label="¿Cuánto quieres retirar?"
        name="amount"
        inputMode="numeric"
        maxLength={10}
        placeholder="Ej. 50000"
        adornment="COP"
        icon={<Icon.Wallet size={20} />}
        value={amount}
        onChange={(e) => {
          setAmount(digitsOnly(e.target.value));
          clearError('amount');
        }}
        error={errors.amount}
        hint={`Mínimo ${formatCurrencyCOP(MIN_WITHDRAWAL_AMOUNT)} · disponible ${formatCurrencyCOP(maxAmount)}`}
        disabled={!canWithdraw}
      />
      {canWithdraw ? (
        <div className="gd-deposit__amounts">
          <button
            type="button"
            className={`gd-amount-chip ${Number(amount) === maxAmount ? 'is-active' : ''}`.trim()}
            aria-pressed={Number(amount) === maxAmount}
            onClick={() => {
              setAmount(String(maxAmount));
              clearError('amount');
            }}
          >
            Todo ({formatCurrencyCOP(maxAmount)})
          </button>
        </div>
      ) : null}

      <Select
        label="Banco de destino"
        name="bank"
        required
        placeholder="Selecciona tu banco"
        options={BANK_OPTIONS}
        icon={<Icon.Bank size={20} />}
        value={bank}
        onChange={(e) => {
          setBank(e.target.value);
          clearError('bank');
        }}
        error={errors.bank}
      />

      <div className="gd-deposit__group">
        <span className="gd-field__label" id="gd-withdraw-type">
          Tipo de cuenta
        </span>
        <div className="gd-deposit__person" role="radiogroup" aria-labelledby="gd-withdraw-type">
          <RadioCard
            selected={accountType === ACCOUNT_TYPES.SAVINGS}
            onSelect={() => setAccountType(ACCOUNT_TYPES.SAVINGS)}
            icon={<Icon.Wallet size={20} />}
            title="Ahorros"
          />
          <RadioCard
            selected={accountType === ACCOUNT_TYPES.CHECKING}
            onSelect={() => setAccountType(ACCOUNT_TYPES.CHECKING)}
            icon={<Icon.CreditCard size={20} />}
            title="Corriente"
          />
        </div>
      </div>

      <Input
        label="Número de cuenta"
        name="accountNumber"
        inputMode="numeric"
        maxLength={20}
        required
        placeholder="Solo dígitos"
        icon={<Icon.IdCard size={20} />}
        value={accountNumber}
        onChange={(e) => {
          setAccountNumber(digitsOnly(e.target.value));
          clearError('accountNumber');
        }}
        error={errors.accountNumber}
        hint="Entre 6 y 20 dígitos, a tu nombre"
      />

      {submitError ? <Alert variant="error">{submitError}</Alert> : null}

      <div className="gd-deposit__actions">
        <Button
          type="submit"
          variant="gold"
          size="lg"
          full
          loading={isSubmitting}
          disabled={!canWithdraw}
          iconRight={<Icon.ChevronRight size={18} />}
        >
          {amount ? `Retirar ${formatCurrencyCOP(amount)}` : 'Retirar'}
        </Button>
        <p className="gd-deposit__secure">
          <Icon.Lock size={14} />
          El dinero sale de tu saldo disponible. Lo que tienes en apuestas abiertas no se toca.
        </p>
      </div>
    </form>
  );
}
