import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import * as matchService from '../../services/matchService';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import TeamCrest from '../ui/TeamCrest';
import Icon from '../ui/icons';
import { formatCurrencyCOP, formatBalance, formatKickoff } from '../../utils/format';
import { digitsOnly } from '../../utils/validators';
import { MIN_BET_AMOUNT, QUICK_BET_AMOUNTS, ROUTES } from '../../utils/constants';

/**
 * "1" -> nombre del local, "2" -> del visitante, "X" -> Empate. El chip solo
 * dice "Local"; en el boleto se escribe el equipo para que nadie apueste al
 * lado equivocado por leer rapido.
 */
function describeSelection(match, odd) {
  const key = String(odd?.key ?? '').toUpperCase();
  if (key === '1') return match?.homeTeam?.name || odd.label;
  if (key === '2') return match?.awayTeam?.name || odd.label;
  if (key === 'X') return 'Empate';
  return odd?.label ?? '';
}

/**
 * Boleto de apuesta simple.
 *
 * La ganancia potencial que se muestra aqui es solo una PISTA: monto × cuota
 * con el valor que trajo la tarjeta. El servidor vuelve a leer la cuota vigente
 * por oddsId y es su `potentialWin` el que vale; por eso, tras apostar, el
 * mensaje de exito usa los numeros de la respuesta y no los de esta pantalla.
 *
 * Lo monta BetSlipProvider con una key por seleccion, asi que el estado nace
 * limpio cada vez y no hay que reiniciarlo a mano.
 */
export default function BetSlipModal({ open, match, odd, onClose }) {
  const { user, refreshUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  if (!match || !odd) return null;

  const value = Number(amount) || 0;
  const decimal = Number(odd.decimal) || Number(odd.value) || 0;
  const potentialWin = Math.round(value * decimal);
  const selection = describeSelection(match, odd);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!value) {
      setFieldError('Ingresa el monto de tu apuesta');
      return;
    }
    if (value < MIN_BET_AMOUNT) {
      setFieldError(`La apuesta mínima es ${formatCurrencyCOP(MIN_BET_AMOUNT)}`);
      return;
    }
    setFieldError('');

    setIsSubmitting(true);
    const res = await matchService.placeBet({ oddsId: odd.oddsId, amount: value });
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.message || 'No pudimos registrar tu apuesta');
      return;
    }

    setResult(res.data);
    // El saldo del navbar y del hero sale de /auth/me: se relee en vez de
    // restarlo a mano aqui, que es como terminan dos pantallas mostrando dos
    // saldos distintos.
    refreshUser();
  }

  const footer = result ? (
    <>
      <Button as={Link} to={ROUTES.MY_BETS} variant="outline" onClick={onClose}>
        Ver mis apuestas
      </Button>
      <Button variant="gold" onClick={onClose} data-autofocus>
        Listo
      </Button>
    </>
  ) : null;

  return (
    <Modal open={open} onClose={onClose} title="Tu apuesta" footer={footer}>
      <div className="gd-betslip">
        <div className="gd-betslip__match">
          <div className="gd-betslip__team">
            <TeamCrest team={match.homeTeam} size={40} />
            <span>{match.homeTeam?.name}</span>
          </div>
          <span className="gd-betslip__vs" aria-hidden="true">
            VS
          </span>
          <div className="gd-betslip__team">
            <TeamCrest team={match.awayTeam} size={40} />
            <span>{match.awayTeam?.name}</span>
          </div>
        </div>
        <p className="gd-betslip__meta">
          {match.league?.name}
          {match.kickoff ? ` · ${formatKickoff(match.kickoff)}` : ''}
        </p>

        <div className="gd-betslip__pick">
          <div>
            <span className="gd-betslip__label">Tu selección</span>
            <strong className="gd-betslip__selection">{selection}</strong>
            <span className="gd-betslip__market">
              {odd.market === '1X2' || !odd.market ? 'Resultado final' : odd.market}
            </span>
          </div>
          <span className="gd-betslip__odd" aria-label={`Cuota ${odd.value}`}>
            {odd.value}
          </span>
        </div>

        {result ? (
          <Alert variant="success">
            <strong>¡Apuesta registrada!</strong> Apostaste {formatCurrencyCOP(result.amount)} y
            podrías ganar {formatCurrencyCOP(result.potentialWin)}. Tu nuevo saldo es{' '}
            <strong>{formatBalance(result.balance)}</strong>.
          </Alert>
        ) : (
          <form className="gd-betslip__form" onSubmit={handleSubmit} noValidate>
            <div className="gd-deposit__amounts" role="group" aria-label="Montos rápidos">
              {QUICK_BET_AMOUNTS.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  className={`gd-amount-chip ${value === quick ? 'is-active' : ''}`.trim()}
                  aria-pressed={value === quick}
                  onClick={() => {
                    setAmount(String(quick));
                    setFieldError('');
                  }}
                >
                  {formatCurrencyCOP(quick)}
                </button>
              ))}
            </div>

            <Input
              label="Monto a apostar"
              name="betAmount"
              inputMode="numeric"
              maxLength={9}
              placeholder="Ej. 10000"
              adornment="COP"
              icon={<Icon.Wallet size={20} />}
              value={amount}
              onChange={(e) => {
                setAmount(digitsOnly(e.target.value));
                setFieldError('');
                setError('');
              }}
              error={fieldError}
              hint={`Apuesta mínima ${formatCurrencyCOP(MIN_BET_AMOUNT)} · saldo ${formatBalance(user?.balance)}`}
              data-autofocus
            />

            <div className="gd-betslip__win" aria-live="polite">
              <span>Ganancia potencial</span>
              <strong>{formatCurrencyCOP(potentialWin)}</strong>
            </div>

            {error ? <Alert variant="error">{error}</Alert> : null}

            <Button type="submit" variant="gold" size="lg" full loading={isSubmitting}>
              Apostar
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
