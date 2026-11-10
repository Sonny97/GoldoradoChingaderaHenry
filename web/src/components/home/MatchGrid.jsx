import MatchCard from './MatchCard';
import Spinner from '../ui/Spinner';
import Icon from '../ui/icons';
import { useBetSlip } from '../../hooks/useBetSlip';

/**
 * Grilla de partidos con sus tres estados: cargando, error y vacio.
 *
 * La clave es match.id, NUNCA el indice: al filtrar por categoria React
 * reutilizaria los nodos DOM y los marcadores y cuotas terminarian pintados
 * sobre el partido equivocado.
 *
 * Es la grilla, y no la tarjeta, la que se conecta al boleto de apuesta: lee
 * BetSlipContext una vez y le pasa a cada MatchCard un callback y el chip a
 * resaltar. El hook va arriba de todo, antes de los returns de estado.
 */
export default function MatchGrid({ matches = [], isLoading = false, error = '', emptyText }) {
  const betSlip = useBetSlip();
  if (isLoading) {
    return (
      <div className="gd-match-grid">
        <div className="gd-match-grid__state">
          <Spinner size={36} label="Cargando partidos" />
          <p>Cargando partidos…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="gd-match-grid">
        <div className="gd-match-grid__state">
          <Icon.Alert size={32} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!matches.length) {
    return (
      <div className="gd-match-grid">
        <div className="gd-match-grid__state">
          <Icon.Football size={32} />
          <p>{emptyText || 'No hay partidos para esta categoría por ahora.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="gd-match-grid gd-stagger">
      {matches.map((match, index) => (
        <MatchCard
          key={match.id}
          match={match}
          index={index}
          onSelectOdd={betSlip?.openBetSlip}
          selectedOddKey={betSlip?.activeOdd?.matchId === match.id ? betSlip.activeOdd.key : null}
        />
      ))}
    </div>
  );
}
