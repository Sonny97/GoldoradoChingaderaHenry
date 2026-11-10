import Icon from '../ui/icons';

/**
 * Un tile de categoria.
 *
 * Es un <button>, no un <Link>: /partidos, /ligas etc. no existen como rutas.
 * Un <Link to="#"> produce navegacion de hash y un salto de scroll. Asi el
 * tile hace algo real hoy (filtrar la grilla) y se convierte en ruta despues
 * cambiando una linea.
 */
export default function CategoryTile({ category, index = 0, active = false, onSelect }) {
  const Glyph = Icon[category.icon] ?? Icon.Football;

  return (
    <button
      type="button"
      className={`gd-cat-tile ${active ? 'is-active' : ''}`}
      style={{ '--i': index }}
      aria-pressed={active}
      onClick={() => onSelect?.(category)}
    >
      <span className="gd-cat-tile__box">
        <span className="gd-cat-tile__icon">
          <Glyph size={36} />
        </span>
      </span>
      <span className="gd-cat-tile__label">{category.label}</span>
    </button>
  );
}
