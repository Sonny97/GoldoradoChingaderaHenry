import { useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BetSlipContext } from './BetSlipContext';
import { useAuth } from '../hooks/useAuth';
import BetSlipModal from '../components/bets/BetSlipModal';
import { ROUTES } from '../utils/constants';

/**
 * Boleto de apuesta.
 *
 * POR QUE UN CONTEXTO Y NO UN CALLBACK BAJANDO DESDE CADA PAGINA. La grilla de
 * partidos aparece en / y en /inicio, y mañana en el detalle de un partido. Si
 * cada pagina tuviera que montar su propio BetSlipModal, repetir las tres
 * reglas de abajo (sesion, perfil, cuota abierta) y pasar un onSelectOdd por
 * MatchGrid, la cuarta pagina que olvide una regla dejaria apostar sin perfil.
 * Con un solo provider las reglas viven en un solo lugar.
 *
 * MatchCard SIGUE SIENDO TONTO: no importa este contexto. Recibe onSelectOdd y
 * selectedOddKey por props; quien lee el contexto es MatchGrid, que es el que
 * ya sabe de listas y estados. Asi la tarjeta se puede pintar sola, sin
 * provider, en cualquier otra parte.
 *
 * Usa hooks de router, por eso vive DENTRO de <BrowserRouter> (lo monta App).
 */
export function BetSlipProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // { match, odd } o null. Un solo estado: abrir el boleto y saber cual chip
  // resaltar son la misma informacion.
  const [slip, setSlip] = useState(null);

  const openBetSlip = useCallback(
    (match, odd) => {
      if (!match || !odd) return;

      // Una cuota cerrada ni siquiera deberia llegar aqui (el chip va
      // deshabilitado), pero el servidor la rechazaria igual: se corta antes.
      if (odd.open === false) return;

      if (!user) {
        navigate(ROUTES.LOGIN, { state: { from: location } });
        return;
      }

      if (user.profileComplete === false) {
        navigate(ROUTES.COMPLETE_PROFILE, { state: { from: location } });
        return;
      }

      setSlip({ match, odd });
    },
    [user, navigate, location]
  );

  // Estable: Modal tiene onClose en las dependencias de su efecto, y una
  // funcion nueva en cada render le robaria el foco al campo del monto.
  const closeBetSlip = useCallback(() => setSlip(null), []);

  const value = useMemo(
    () => ({
      openBetSlip,
      activeOdd: slip ? { matchId: slip.match.id, key: slip.odd.key } : null,
    }),
    [openBetSlip, slip]
  );

  return (
    <BetSlipContext.Provider value={value}>
      {children}
      {/* key: cada seleccion nueva arranca con el formulario limpio, sin el
          monto ni el resultado de la apuesta anterior. */}
      {slip ? (
        <BetSlipModal
          key={`${slip.match.id}-${slip.odd.oddsId ?? slip.odd.key}`}
          open
          match={slip.match}
          odd={slip.odd}
          onClose={closeBetSlip}
        />
      ) : null}
    </BetSlipContext.Provider>
  );
}
