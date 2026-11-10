import CategoryTile from './CategoryTile';

/**
 * Fila de 5 categorias del boceto.
 *
 * Las cajas miden todas IGUAL. En el boceto crecen hacia la derecha, pero eso
 * es un artefacto del dibujo a mano: escalarlas de verdad (0.85 -> 1.15) se
 * lee como grilla rota. El crescendo se consigue rampando la opacidad del
 * borde dorado (--i en el CSS), la escala del icono dentro de la caja fija, y
 * el retraso de entrada.
 */
export default function CategoryTiles({ categories = [], activeId, onSelect }) {
  if (!categories.length) return null;

  return (
    <section className="gd-section" id="categorias">
      <div className="gd-container">
        <header className="gd-section__head">
          <div>
            <span className="gd-eyebrow">
              <span className="gd-eyebrow__dot" />
              Explora
            </span>
            <h2 className="gd-section__title">Categorías</h2>
          </div>
        </header>

        <ul className="gd-cats__row gd-stagger">
          {categories.map((category, index) => (
            <li key={category.id} className="gd-cats__item" style={{ '--i': index }}>
              <CategoryTile
                category={category}
                index={index}
                active={category.id === activeId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
