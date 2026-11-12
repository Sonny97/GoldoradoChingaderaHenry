import { useState, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BetSlipContext } from './BetSlipContext';
import { useAuth } from '../hooks/useAuth';
import BetSlipModal from '../components/bets/BetSlipModal';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
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
  // Mensaje cuando el clic en una cuota NO puede abrir el boleto.
  const [aviso, setAviso] = useState('');
  const cerrarAviso = useCallback(() => setAviso(''), []);

  const openBetSlip = useCallback(
    (match, odd) => {
      if (!match || !odd) return;

      // Una cuota cerrada ni siquiera deberia llegar aqui (el chip va
      // deshabilitado), pero el servidor la rechazaria igual: se corta antes.
      if (odd.open === false) return;

      if (!user) {
        // El aviso viaja en el state: sin el, el usuario aparece en el login
        // sin saber por que su clic en la cuota "no hizo nada".
        navigate(ROUTES.LOGIN, { state: { from: location, aviso: 'Inicia sesión para hacer tu apuesta.' } });
        return;
      }

      // El administrador no tiene ficha de cliente ni billetera: no apuesta.
      // Mandarlo a "completar perfil" parecia que el clic no hacia nada (y lo
      // invitaba a volverse cliente). Se le explica con un aviso.
      if (user.role === 'admin') {
        setAviso('Las cuentas de administrador no pueden apostar. Entra con una cuenta de cliente, por ejemplo demo@goldorado.co.');
        return;
      }

      if (user.profileComplete === false) {
        navigate(ROUTES.COMPLETE_PROFILE, { state: { from: location, aviso: 'Completa tu perfil para poder apostar.' } });
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
      <Modal
        open={Boolean(aviso)}
        onClose={cerrarAviso}
        title="No puedes apostar con esta cuenta"
        footer={
          <Button variant="gold" onClick={cerrarAviso} data-autofocus>
            Entendido
          </Button>
        }
      >
        <Alert variant="info">{aviso}</Alert>
      </Modal>
    </BetSlipContext.Provider>
  );
}
