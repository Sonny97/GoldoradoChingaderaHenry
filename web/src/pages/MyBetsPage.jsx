import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import * as matchService from '../services/matchService';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import Spinner from '../components/ui/Spinner';
import Icon from '../components/ui/icons';
import StatusBadge from '../components/wallet/StatusBadge';
import { formatCurrencyCOP, formatDateTime, formatKickoff } from '../utils/format';
import { ROUTES } from '../utils/constants';

/** Congelado a nivel de modulo: useAsync fija initialData del primer render. */
const RESUMEN_VACIO = { total: 0, won: 0, lost: 0, pending: 0, staked: 0, returned: 0, roi: 0 };

/**
 * El historial trae el partido resumido por ms-deportes. Si ese servicio no
 * respondio, el BFF manda la apuesta sin nombres (degradacion elegante) y aqui
 * se escribe "Partido #id" en vez de romper la fila.
 */
const nombre = (valor) => (typeof valor === 'string' ? valor : valor?.name ?? '');

function describePick(bet) {
  const key = String(bet.selection ?? '').toUpperCase();
  const home = nombre(bet.match?.home);
  const away = nombre(bet.match?.away);
  if (key === '1') return home || 'Local';
  if (key === '2') return away || 'Visitante';
  if (key === 'X') return 'Empate';
  return bet.selection ?? '';
}

/**
 * /mis-apuestas: resumen del usuario y sus ultimas apuestas.
 */
export default function MyBetsPage() {
  const fetchSummary = useCallback(() => matchService.getBetSummary(), []);
  const fetchBets = useCallback(() => matchService.getMyBets({ limit: 20 }), []);

  const summary = useAsync(fetchSummary, [], { initialData: RESUMEN_VACIO });
  const bets = useAsync(fetchBets, [], { initialData: [] });
  const stats = summary.data ?? RESUMEN_VACIO;
  const roi = Number(stats.roi) || 0;

  return (
    <section className="gd-section gd-container gd-bets">
      <header className="gd-page-head">
        <span className="gd-eyebrow">
          <span className="gd-eyebrow__dot" />
          Tu juego
        </span>
        <h1 className="gd-section__title">Mis apuestas</h1>
      </header>

      <ul className="gd-bets__summary" aria-label="Resumen de tus apuestas">
        <li className="gd-bets__stat">
          <span>Apuestas</span>
          <strong>{stats.total}</strong>
        </li>
        <li className="gd-bets__stat">
          <span>Ganadas</span>
          <strong className={stats.won > 0 ? 'is-win' : undefined}>{stats.won}</strong>
        </li>
        <li className="gd-bets__stat">
          <span>Perdidas</span>
          <strong>{stats.lost}</strong>
        </li>
        <li className="gd-bets__stat">
          <span>En juego</span>
          <strong>{stats.pending}</strong>
        </li>
        <li className="gd-bets__stat">
          <span>Apostado</span>
          <strong>{formatCurrencyCOP(stats.staked)}</strong>
        </li>
        <li className="gd-bets__stat">
          <span>Rendimiento</span>
          <strong className={roi >= 0 ? 'is-win' : 'is-lose'}>
            {roi >= 0 ? '+' : ''}
            {roi}%
          </strong>
        </li>
      </ul>

      {summary.error ? <Alert variant="error">{summary.error}</Alert> : null}

      <Card padding="lg" className="gd-bets__panel">
        <header className="gd-wallet__panel-head">
          <h2 className="gd-wallet__panel-title">Últimas apuestas</h2>
          <Button variant="ghost" size="sm" onClick={bets.reload} disabled={bets.isLoading}>
            Actualizar
          </Button>
        </header>

        {bets.isLoading ? (
          <div className="gd-wallet__state">
            <Spinner size={28} label="Cargando apuestas" />
          </div>
        ) : bets.error ? (
          <Alert variant="error">{bets.error}</Alert>
        ) : !bets.data?.length ? (
          <div className="gd-wallet__empty gd-bets__empty">
            <Icon.Ticket size={32} />
            <p>Todavía no has hecho apuestas.</p>
            <Button as={Link} to={`${ROUTES.DASHBOARD}#partidos`} variant="gold" size="sm">
              Ver partidos
            </Button>
          </div>
        ) : (
          <ul className="gd-bet-list">
            {bets.data.map((bet) => {
              const home = nombre(bet.match?.home);
              const away = nombre(bet.match?.away);
              const title = home && away ? `${home} vs ${away}` : `Partido #${bet.match?.id ?? '—'}`;
              const league = nombre(bet.match?.league);

              return (
                <li key={bet.id} className="gd-bet-row">
                  <div className="gd-bet-row__main">
                    <span className="gd-bet-row__match">{title}</span>
                    <span className="gd-bet-row__meta">
                      {league ? `${league} · ` : ''}
                      {bet.match?.kickoff ? formatKickoff(bet.match.kickoff) : formatDateTime(bet.placedAt)}
                    </span>
                    <span className="gd-bet-row__pick">
                      {describePick(bet)}
                      {Number.isFinite(Number(bet.odds)) && bet.odds !== null ? (
                        <span className="gd-bet-row__odd">@ {Number(bet.odds).toFixed(2)}</span>
                      ) : null}
                    </span>
                  </div>

                  <div className="gd-bet-row__nums">
                    <div>
                      <span className="gd-bet-row__label">Apostado</span>
                      <strong>{formatCurrencyCOP(bet.amount)}</strong>
                    </div>
                    <div>
                      <span className="gd-bet-row__label">Ganancia potencial</span>
                      <strong className="gd-text-gold">{formatCurrencyCOP(bet.potentialWin)}</strong>
                    </div>
                  </div>

                  <div className="gd-bet-row__status">
                    <StatusBadge status={bet.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
