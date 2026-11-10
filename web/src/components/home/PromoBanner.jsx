import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Icon from '../ui/icons';

/**
 * Banner destacado del boceto: "50% descuento" + boton de detalle.
 *
 * El "50%" gigante en contorno detras del contenido es lo que hace que esto
 * se lea como promo de casino y no como tarjeta de marketing generica.
 * Cuesta un pseudo-elemento.
 *
 * `imageUrl` (ms-imagenes) es opcional y va como fondo TENUE, por debajo del
 * texto y del fantasma: la promo se lee por su titulo, no por la foto. Sin
 * imagen el banner queda exactamente como antes.
 */
export default function PromoBanner({ promo, onDetail }) {
  if (!promo) return null;

  // Toma el numero del titulo para el fantasma de fondo ("50% descuento" -> "50%").
  const ghost = promo.title.match(/\d+\s*%?/)?.[0]?.trim() || promo.title.slice(0, 3);

  return (
    <section className={`gd-promo-banner ${promo.imageUrl ? 'gd-promo-media-host' : ''}`.trim()}>
      {promo.imageUrl ? (
        <span
          className="gd-promo-media"
          style={{ backgroundImage: `url(${JSON.stringify(promo.imageUrl)})` }}
          aria-hidden="true"
        />
      ) : null}

      <span className="gd-promo-banner__ghost" aria-hidden="true">
        {ghost}
      </span>

      {promo.badge ? <Badge variant="gold">{promo.badge}</Badge> : null}

      <h2 className="gd-promo-banner__title">{promo.title}</h2>
      <p className="gd-promo-banner__text">{promo.description}</p>

      <div className="gd-promo-banner__cta">
        <Button
          variant="gold"
          size="lg"
          iconRight={<Icon.ChevronRight size={18} />}
          onClick={() => onDetail?.(promo)}
        >
          {promo.ctaLabel || 'Ver detalle'}
        </Button>
      </div>
    </section>
  );
}
