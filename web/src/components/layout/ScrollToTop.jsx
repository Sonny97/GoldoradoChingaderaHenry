import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Vuelve arriba en cada cambio de ruta.
 *
 * <ScrollRestoration> de React Router solo funciona con el data router
 * (createBrowserRouter). Usamos el <BrowserRouter> declarativo porque
 * AuthProvider debe envolver el arbol y el data router lo complica, asi que
 * esto va a mano.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
