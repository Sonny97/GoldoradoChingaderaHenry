import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';

/**
 * Shell compartido por TODAS las rutas.
 *
 * Asi es como / e /inicio comparten navbar y footer siendo dos paginas
 * independientes: el Navbar lee useAuth() y cambia sus propios enlaces; las
 * paginas no se conocen entre si.
 */
export default function Layout() {
  return (
    <div className="gd-shell">
      <a href="#contenido" className="gd-skip-link">
        Saltar al contenido
      </a>

      <Navbar />

      <main id="contenido" className="gd-main">
        <Outlet />
      </main>

      <Footer />
    </div>
  );
}
