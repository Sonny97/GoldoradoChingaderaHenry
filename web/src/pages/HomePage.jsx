import { useState, useCallback } from 'react';
import { useAsync } from '../hooks/useAsync';
import * as matchService from '../services/matchService';
import Hero from '../components/home/Hero';
import CategoryTiles from '../components/home/CategoryTiles';
import MatchGrid from '../components/home/MatchGrid';
import { CATEGORIES } from '../data/categories';

/**
 * Home publico.
 *
 * Las categorias se importan sincronas para que la fila no parpadee, pero los
 * partidos SI pasan por el servicio, que es donde vive el filtro.
 */
const EMPTY_TEXT = {
  esports: 'Todavía no hay partidos de E-Fútbol programados. Vuelve pronto.',
  finished: 'No hay partidos finalizados esta jornada.',
};

export default function HomePage() {
  const [category, setCategory] = useState(CATEGORIES[0]);

  const fetchMatches = useCallback(
    () => matchService.getMatches({ status: category.filter }),
    [category.filter]
  );

  const { data: matches, error, isLoading } = useAsync(fetchMatches, [category.filter], {
    initialData: [],
  });

  return (
    <>
      <Hero />

      <CategoryTiles
        categories={CATEGORIES}
        activeId={category.id}
        onSelect={setCategory}
      />

      <section className="gd-section gd-container" id="partidos">
        <header className="gd-section__head">
          <div>
            <span className="gd-eyebrow">
              <span className="gd-eyebrow__dot" />
              En vivo y próximos
            </span>
            <h2 className="gd-section__title">{category.label}</h2>
          </div>
          <span className="gd-link-gold" aria-live="polite">
            {isLoading ? 'Cargando…' : `${matches.length} partidos`}
          </span>
        </header>

        <MatchGrid
          matches={matches}
          isLoading={isLoading}
          error={error}
          emptyText={EMPTY_TEXT[category.filter]}
        />
      </section>
    </>
  );
}
