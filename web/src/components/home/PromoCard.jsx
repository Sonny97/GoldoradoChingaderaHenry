import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Icon from '../ui/icons';
import { formatDate } from '../../utils/format';

/**
 * Tarjeta de promocion. `imageUrl` opcional como fondo tenue (ver PromoBanner).
 * JSON.stringify entrecomilla y escapa la URL dentro de url(): un parentesis o
 * una comilla en la ruta no rompe la regla CSS.
 */
export default function PromoCard({ promo, index = 0, onDetail }) {
  if (!promo) return null;

  return (
    <Card
      as="article"
      padding="md"
      interactive
      className={`gd-promo-card gd-promo-card--${promo.accent || 'gold'} ${promo.imageUrl ? 'gd-promo-media-host' : ''}`.trim()}
      style={{ '--i': index }}
    >
      {promo.imageUrl ? (
        <span
          className="gd-promo-media"
          style={{ backgroundImage: `url(${JSON.stringify(promo.imageUrl)})` }}
          aria-hidden="true"
        />
      ) : null}

      <header className="gd-promo-card__head">
        <div>
          <h3 className="gd-promo-card__title">{promo.title}</h3>
          <p className="gd-promo-card__subtitle">{promo.subtitle}</p>
        </div>
        {promo.badge ? <Badge variant="gold">{promo.badge}</Badge> : null}
      </header>

      <p className="gd-promo-card__text">{promo.description}</p>

      <footer className="gd-promo-card__foot">
        <span className="gd-promo-card__expiry">
          Hasta el {formatDate(promo.expiresAt)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          iconRight={<Icon.ChevronRight size={14} />}
          onClick={() => onDetail?.(promo)}
        >
          {promo.ctaLabel || 'Ver detalle'}
        </Button>
      </footer>
    </Card>
  );
}
