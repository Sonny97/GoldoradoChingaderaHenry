import { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAsync } from '../hooks/useAsync';
import * as promoService from '../services/promoService';
import * as matchService from '../services/matchService';
import HeroWelcome from '../components/home/HeroWelcome';
import PromoBanner from '../components/home/PromoBanner';
import PromoSection from '../components/home/PromoSection';
import MatchGrid from '../components/home/MatchGrid';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { formatDate } from '../utils/format';

/**
 * Valor inicial del panel "Tu semana".
 *
 * Es un objeto congelado a nivel de modulo, NO un literal inline: useAsync
 * congela `initialData` del primer render, y un literal nuevo en cada render
 * seria una dependencia distinta cada vez.
 */
const SUMMARY_VACIO = { total: 0, won: 0, lost: 0, pending: 0, staked: 0, returned: 0, roi: 0 };

/**
 * Home autenticado.
 *
 * El banner destacado NO va solo a 1200 px de ancho: estirado con un boton
 * pequeño flotando en navy se ve inacabado. Se empareja con el panel
 * "Tu semana".
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const [detail, setDetail] = useState(null);

  const fetchFeatured = useCallback(() => promoService.getFeaturedPromo(), []);
  const fetchPromos = useCallback(
    () => promoService.getPromos({ limit: 3, excludeFeatured: true }),
    []
  );
  const fetchMatches = useCallback(() => matchService.getFeaturedMatches(4), []);
  const fetchSummary = useCallback(() => matchService.getBetSummary(), []);

  const featured = useAsync(fetchFeatured, [], { initialData: null });
  const promos = useAsync(fetchPromos, [], { initialData: [] });
  const matches = useAsync(fetchMatches, [], { initialData: [] });

  // Antes estos tres numeros estaban escritos a mano en el JSX. Ahora salen de
  // un GROUP BY sobre la tabla Apuesta del usuario que tiene la sesion abierta.
  const summary = useAsync(fetchSummary, [], { initialData: SUMMARY_VACIO });
  const stats = summary.data ?? SUMMARY_VACIO;

  return (
    <>
      <HeroWelcome user={user} />

      <section className="gd-section gd-container">
        <div className="gd-promo-lead">
          <PromoBanner promo={featured.data} onDetail={setDetail} />

          <Card as="aside" padding="md" className="gd-promo-lead__side" gold>
            <h3 className="gd-promo-lead__side-title">Tu semana</h3>
            <ul className="gd-promo-lead__stats">
              <li>
                <span>Apuestas</span>
                <strong>{stats.total}</strong>
              </li>
              <li>
                <span>Ganadas</span>
                <strong className={stats.won > 0 ? 'is-win' : undefined}>{stats.won}</strong>
              </li>
              <li>
                <span>Rendimiento</span>
                {/* El signo se pone aqui: un +0% se lee mejor que un 0% suelto,
                    y un rendimiento negativo no debe pintarse de verde. */}
                <strong className={stats.roi >= 0 ? 'is-win' : undefined}>
                  {stats.roi >= 0 ? '+' : ''}
                  {stats.roi}%
                </strong>
              </li>
            </ul>
          </Card>
        </div>
      </section>

      <div className="gd-container">
        <hr className="gd-divider gd-divider--gold" />
      </div>

      <PromoSection promos={promos.data} isLoading={promos.isLoading} onDetail={setDetail} />

      <section className="gd-section gd-container" id="partidos">
        <header className="gd-section__head">
          <div>
            <span className="gd-eyebrow">
              <span className="gd-eyebrow__dot" />
              Para ti
            </span>
            <h2 className="gd-section__title">Partidos destacados</h2>
          </div>
        </header>

        <MatchGrid
          matches={matches.data}
          isLoading={matches.isLoading}
          error={matches.error}
        />
      </section>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title}
        footer={
          <Button variant="gold" onClick={() => setDetail(null)} data-autofocus>
            Entendido
          </Button>
        }
      >
        {detail ? (
          <>
            <p style={{ marginBottom: 'var(--gd-sp-3)' }}>{detail.description}</p>
            <p style={{ color: 'var(--gd-text-dim)', fontSize: 'var(--gd-fz-sm)' }}>
              Vigente hasta el {formatDate(detail.expiresAt)}.
            </p>
          </>
        ) : null}
      </Modal>
    </>
  );
}
