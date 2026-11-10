/**
 * Franja de cuotas al pie de la tarjeta de partido.
 *
 * `odds` es un array, asi que esto es un .map() y nada mas. Con un objeto de
 * claves fijas home/draw/away habria que hardcodear los cuatro chips en JSX.
 *
 * Una cuota cerrada (odd.open === false: el mercado se suspendio o el partido
 * termino) sale DESHABILITADA y no oculta: quitar el chip haria saltar la
 * franja y el usuario creeria que la cuota nunca existio.
 */
export default function OddsStrip({ odds = [], matchLabel = '', selected, onSelect }) {
  if (!odds.length) return null;

  return (
    <div className="gd-match-card__odds" role="group" aria-label={`Cuotas ${matchLabel}`}>
      {odds.map((odd) => {
        const closed = odd.open === false;
        return (
          <button
            key={odd.oddsId ?? odd.key}
            type="button"
            className={`gd-odd ${selected === odd.key ? 'is-active' : ''} ${closed ? 'is-closed' : ''}`.trim()}
            aria-pressed={selected === odd.key}
            aria-label={closed ? `${odd.label}, cuota cerrada` : `${odd.label}, paga ${odd.value}`}
            title={closed ? 'Cuota cerrada' : undefined}
            disabled={closed}
            onClick={() => onSelect?.(odd)}
          >
            <span className="gd-odd__label">{odd.label}</span>
            <span className="gd-odd__value">{odd.value}</span>
          </button>
        );
      })}
    </div>
  );
}
