import { useState } from 'react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import TeamCrest from '../ui/TeamCrest';
import OddsStrip from './OddsStrip';
import { formatKickoff, formatMinute } from '../../utils/format';
import { MATCH_STATUS } from '../../utils/constants';

/**
 * Tarjeta de partido del boceto: [escudo] VS [escudo], marcador bajo cada
 * escudo, y la franja de cuotas al pie.
 *
 * Es un <article>, NO va envuelta en un <Link>: la franja de cuotas contiene
 * <button>s, y un boton dentro de un enlace es HTML invalido, se activa dos
 * veces y rompe la navegacion por teclado.
 *
 * Componente tonto: recibe el partido ya hidratado por matchService y no
 * resuelve ni un solo id.
 *
 * TAMPOCO SABE APOSTAR. Si el padre pasa `onSelectOdd`, el clic en un chip se
 * le entrega tal cual (match, odd) y el padre decide: abrir el boleto, mandar
 * a /login o a /completar-perfil. `selectedOddKey` dice que chip resaltar
 * mientras el boleto esta abierto. Sin `onSelectOdd` la tarjeta vuelve al
 * comportamiento original: el chip solo se marca y desmarca.
 */
export default function MatchCard({ match, index = 0, onSelectOdd, selectedOddKey }) {
  const [localSelected, setLocalSelected] = useState(null);
  const controlled = typeof onSelectOdd === 'function';
  const selected = controlled ? selectedOddKey ?? null : localSelected;

  const { homeTeam, awayTeam, league, homeScore, awayScore, status, minute, kickoff, odds } = match;

  const isLive = status === MATCH_STATUS.LIVE;
  const isUpcoming = status === MATCH_STATUS.UPCOMING;
  const label = `${homeTeam?.name ?? ''} contra ${awayTeam?.name ?? ''}`;

  const renderScore = (value) =>
    isUpcoming ? (
      <span className="gd-match-card__score gd-match-card__score--pending">-</span>
    ) : (
      <span className="gd-match-card__score">{value}</span>
    );

  return (
    <Card
      as="article"
      padding="none"
      interactive
      className="gd-match-card"
      style={{ '--i': index }}
    >
      <header className="gd-match-card__meta">
        {isLive ? (
          <Badge variant="live" dot>
            En vivo
          </Badge>
        ) : isUpcoming ? (
          <Badge variant="info">{formatKickoff(kickoff)}</Badge>
        ) : (
          <Badge variant="neutral">Finalizado</Badge>
        )}

        <span className="gd-match-card__league">
          {league?.name}
          {isLive ? (
            <span className="gd-match-card__min">{formatMinute(minute)}</span>
          ) : null}
        </span>
      </header>

      <div className="gd-match-card__teams">
        <div className="gd-match-card__side">
          <TeamCrest team={homeTeam} size={56} winning={!isUpcoming && homeScore > awayScore} />
          <span className="gd-match-card__name">{homeTeam?.name}</span>
          {renderScore(homeScore)}
        </div>

        <span className="gd-match-card__vs" aria-hidden="true">
          VS
        </span>

        <div className="gd-match-card__side">
          <TeamCrest team={awayTeam} size={56} winning={!isUpcoming && awayScore > homeScore} />
          <span className="gd-match-card__name">{awayTeam?.name}</span>
          {renderScore(awayScore)}
        </div>
      </div>

      <OddsStrip
        odds={odds}
        matchLabel={label}
        selected={selected}
        onSelect={(odd) => {
          if (controlled) onSelectOdd(match, odd);
          else setLocalSelected((prev) => (prev === odd.key ? null : odd.key));
        }}
      />
    </Card>
  );
}
