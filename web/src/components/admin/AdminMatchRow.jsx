import { useState } from 'react';
import * as adminService from '../../services/adminService';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import TeamCrest from '../ui/TeamCrest';
import Icon from '../ui/icons';
import { formatCurrencyCOP, formatKickoff, formatMinute } from '../../utils/format';
import { digitsOnly } from '../../utils/validators';
import { MATCH_STATUS } from '../../utils/constants';

/** Estados que el admin puede elegir, en el orden natural de un partido. */
export const STATUS_OPTIONS = [
  { value: MATCH_STATUS.UPCOMING, label: 'Próximo', badge: 'info' },
  { value: MATCH_STATUS.LIVE, label: 'En vivo', badge: 'live' },
  { value: MATCH_STATUS.FINISHED, label: 'Finalizado', badge: 'neutral' },
  { value: MATCH_STATUS.CANCELED, label: 'Cancelado', badge: 'lose' },
];

const DESCRIPCION = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o]));

/** Terminado = se liquida al guardar y queda de solo lectura. */
const isClosed = (status) => status === MATCH_STATUS.FINISHED || status === MATCH_STATUS.CANCELED;

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Settlement -> "3 apuestas liquidadas: 1 ganada, 2 perdidas · $ 10.000 pagados" */
export function describeSettlement(s) {
  if (!s) return '';
  if (!s.settled) return 'No había apuestas pendientes: nada por liquidar.';
  const partes = [];
  if (s.won) partes.push(plural(s.won, 'ganada', 'ganadas'));
  if (s.lost) partes.push(plural(s.lost, 'perdida', 'perdidas'));
  if (s.voided) partes.push(plural(s.voided, 'anulada', 'anuladas'));
  return `${plural(s.settled, 'apuesta liquidada', 'apuestas liquidadas')}: ${partes.join(', ')} · ${formatCurrencyCOP(s.paidOut)} pagados`;
}

export function MatchStatusBadge({ status }) {
  const d = DESCRIPCION[status] ?? { label: status || 'Sin estado', badge: 'neutral' };
  return (
    <Badge variant={d.badge} dot={status === MATCH_STATUS.LIVE}>
      {d.label}
    </Badge>
  );
}

const aTexto = (n) => (n === null || n === undefined ? '' : String(n));

/**
 * Una fila del panel: el partido y sus controles.
 *
 * `outcome` es lo que paso al guardar en ESTA sesion: { settlement, message }.
 * settlement null con el partido ya terminado significa que el partido se
 * guardo pero la liquidacion fallo: se ofrece el reintento (idempotente).
 */
export default function AdminMatchRow({ match, outcome, onSaved, onSettled }) {
  const [status, setStatus] = useState(match.status);
  const [minute, setMinute] = useState(aTexto(match.minute));
  const [homeScore, setHomeScore] = useState(aTexto(match.homeScore ?? 0));
  const [awayScore, setAwayScore] = useState(aTexto(match.awayScore ?? 0));

  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState('');

  const readOnly = isClosed(match.status);
  const showMinute = status === MATCH_STATUS.LIVE;
  const showScore = status === MATCH_STATUS.LIVE || status === MATCH_STATUS.FINISHED;
  const hasScore = match.homeScore !== null && match.homeScore !== undefined;

  function validate() {
    if (showMinute) {
      const m = Number(minute);
      if (minute === '' || !Number.isInteger(m) || m < 0 || m > 130) return 'El minuto debe estar entre 0 y 130';
    }
    if (showScore) {
      const h = Number(homeScore);
      const a = Number(awayScore);
      if (homeScore === '' || awayScore === '' || h > 99 || a > 99) return 'El marcador debe estar entre 0 y 99';
    }
    return '';
  }

  async function save() {
    const problem = validate();
    setError(problem);
    if (problem) return;

    // Terminar el partido mueve dinero: se pide confirmacion explicita.
    if (isClosed(status) && !confirming) {
      setConfirming(true);
      return;
    }

    setSaving(true);
    const res = await adminService.updateMatch(match.id, {
      status,
      minute: showMinute ? Number(minute) : undefined,
      homeScore: showScore ? Number(homeScore) : undefined,
      awayScore: showScore ? Number(awayScore) : undefined,
    });
    setSaving(false);
    setConfirming(false);

    if (!res.success || !res.data) {
      setError(res.message || 'No pudimos guardar el partido');
      return;
    }
    onSaved(res.data.match, res.data.settlement ?? null, res.message);
  }

  async function settle() {
    setSettling(true);
    setError('');
    const res = await adminService.settleMatch(match.id);
    setSettling(false);
    if (!res.success || !res.data) {
      setError(res.message || 'La liquidación volvió a fallar. Intenta en un momento.');
      return;
    }
    onSettled(match.id, res.data);
  }

  const dirty =
    status !== match.status ||
    (showMinute && minute !== aTexto(match.minute)) ||
    (showScore && (homeScore !== aTexto(match.homeScore ?? 0) || awayScore !== aTexto(match.awayScore ?? 0)));

  const pendingSettlement = readOnly && outcome && !outcome.settlement;

  return (
    <li className={`gd-admin-row ${readOnly ? 'is-closed' : ''}`.trim()}>
      <div className="gd-admin-row__match">
        <div className="gd-admin-row__teams">
          <span className="gd-admin-row__team">
            <TeamCrest team={match.homeTeam} size={28} />
            <span>{match.homeTeam?.name ?? 'Local'}</span>
          </span>
          <strong className="gd-admin-row__score" aria-label="Marcador">
            {hasScore ? `${match.homeScore} - ${match.awayScore}` : 'vs'}
          </strong>
          <span className="gd-admin-row__team gd-admin-row__team--away">
            <span>{match.awayTeam?.name ?? 'Visitante'}</span>
            <TeamCrest team={match.awayTeam} size={28} />
          </span>
        </div>
        <div className="gd-admin-row__meta">
          <MatchStatusBadge status={match.status} />
          {match.status === MATCH_STATUS.LIVE && match.minute !== null ? (
            <span className="gd-admin-row__minute">{formatMinute(match.minute)}</span>
          ) : null}
          <span>
            {match.league?.name ? `${match.league.name} · ` : ''}
            {match.kickoff ? formatKickoff(match.kickoff) : `Partido #${match.id}`}
          </span>
        </div>
      </div>

      {readOnly ? (
        <div className="gd-admin-row__closed">
          <span className="gd-admin-row__lock">
            <Icon.Lock size={14} />
            Partido cerrado
          </span>
          {!pendingSettlement ? (
            <Button variant="ghost" size="sm" onClick={settle} loading={settling}>
              Verificar liquidación
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="gd-admin-row__controls">
          <div className="gd-admin-seg" role="radiogroup" aria-label={`Estado de partido #${match.id}`}>
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={status === o.value}
                className={`gd-admin-seg__btn ${status === o.value ? 'is-active' : ''}`.trim()}
                onClick={() => {
                  setStatus(o.value);
                  setConfirming(false);
                  setError('');
                }}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="gd-admin-row__inputs">
            {showMinute ? (
              <label className="gd-admin-num">
                <span>Minuto</span>
                <input
                  inputMode="numeric"
                  maxLength={3}
                  value={minute}
                  onChange={(e) => setMinute(digitsOnly(e.target.value))}
                />
              </label>
            ) : null}
            {showScore ? (
              <>
                <label className="gd-admin-num">
                  <span>{match.homeTeam?.short ?? 'Local'}</span>
                  <input
                    inputMode="numeric"
                    maxLength={2}
                    value={homeScore}
                    onChange={(e) => setHomeScore(digitsOnly(e.target.value))}
                  />
                </label>
                <label className="gd-admin-num">
                  <span>{match.awayTeam?.short ?? 'Visita'}</span>
                  <input
                    inputMode="numeric"
                    maxLength={2}
                    value={awayScore}
                    onChange={(e) => setAwayScore(digitsOnly(e.target.value))}
                  />
                </label>
              </>
            ) : null}

            {!confirming ? (
              <Button variant="gold" size="sm" onClick={save} loading={saving} disabled={!dirty}>
                Guardar
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {confirming ? (
        <div className="gd-admin-row__confirm" role="alertdialog" aria-label="Confirmar cierre del partido">
          <p>
            <Icon.Alert size={16} />
            <span>
              <strong>
                Marcar como {DESCRIPCION[status]?.label.toLowerCase()}
                {status === MATCH_STATUS.FINISHED ? ` ${homeScore} - ${awayScore}` : ''}.
              </strong>{' '}
              Esto liquida las apuestas y no se puede deshacer.
            </span>
          </p>
          <div className="gd-admin-row__confirm-actions">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="gold" size="sm" onClick={save} loading={saving}>
              Confirmar y liquidar
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert variant="error" className="gd-admin-row__result">
          {error}
        </Alert>
      ) : null}

      {outcome?.settlement ? (
        <p className="gd-admin-row__result gd-admin-settled">
          <Icon.CheckCircle size={16} />
          {describeSettlement(outcome.settlement)}
        </p>
      ) : null}

      {pendingSettlement ? (
        <div className="gd-admin-row__result gd-admin-row__retry">
          <Alert variant="gold">
            {outcome.message || 'El partido se guardó, pero las apuestas no se liquidaron.'}
          </Alert>
          <Button variant="gold" size="sm" onClick={settle} loading={settling}>
            Reintentar liquidación
          </Button>
        </div>
      ) : null}
    </li>
  );
}
