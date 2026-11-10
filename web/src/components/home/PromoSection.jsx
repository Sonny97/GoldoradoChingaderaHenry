import PromoCard from './PromoCard';
import Spinner from '../ui/Spinner';

/**
 * Seccion "Promos" del boceto: encabezado + 3 tarjetas.
 */
export default function PromoSection({ promos = [], isLoading = false, onDetail }) {
  return (
    <section className="gd-section gd-container" id="promos">
      <header className="gd-section__head">
        <div>
          <span className="gd-eyebrow">
            <span className="gd-eyebrow__dot" />
            Promos
          </span>
          <h2 className="gd-section__title">Promociones para ti</h2>
        </div>
      </header>

      {isLoading ? (
        <div className="gd-match-grid__state">
          <Spinner size={32} label="Cargando promociones" />
        </div>
      ) : (
        <div className="gd-promo-grid gd-stagger">
          {promos.map((promo, index) => (
            <PromoCard key={promo.id} promo={promo} index={index} onDetail={onDetail} />
          ))}
        </div>
      )}
    </section>
  );
}
