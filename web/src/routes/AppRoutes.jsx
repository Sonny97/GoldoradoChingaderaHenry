import { Routes, Route } from 'react-router-dom';
import Layout from '../components/layout/Layout';
import ProtectedRoute from './ProtectedRoute';
import GuestRoute from './GuestRoute';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import RecoverPage from '../pages/RecoverPage';
import DashboardPage from '../pages/DashboardPage';
import AuthCallbackPage from '../pages/AuthCallbackPage';
import CompleteProfilePage from '../pages/CompleteProfilePage';
import ProfilePage from '../pages/ProfilePage';
import WalletPage from '../pages/WalletPage';
import MyBetsPage from '../pages/MyBetsPage';
import PaymentResultPage from '../pages/PaymentResultPage';
import AdminPage from '../pages/AdminPage';
import NotFoundPage from '../pages/NotFoundPage';

/**
 * Tabla de rutas unica de la app.
 *
 * Los guards son LAYOUT ROUTES (<Route element={<Guard/>}> que renderiza un
 * <Outlet/>), no wrappers alrededor de children: la tabla queda plana y
 * agregar una ruta protegida despues es una sola linea. Las cinco pantallas
 * nuevas de los microservicios lo confirman: fueron cinco lineas.
 *
 * Todas viven dentro del mismo <Layout>. Asi / e /inicio comparten navbar y
 * footer siendo dos paginas independientes.
 */
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />

        <Route element={<GuestRoute />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="registro" element={<RegisterPage />} />
          <Route path="recuperar" element={<RecoverPage />} />
        </Route>

        {/*
          FUERA de GuestRoute a proposito. El callback recibe el token y hace
          setUser; si estuviera bajo GuestRoute, en ese mismo commit el guard
          veria user !== null y mandaria a /inicio antes de que la pagina
          decidiera si el destino es /completar-perfil.
        */}
        <Route path="auth/callback" element={<AuthCallbackPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="inicio" element={<DashboardPage />} />
          <Route path="completar-perfil" element={<CompleteProfilePage />} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="billetera" element={<WalletPage />} />
          <Route path="mis-apuestas" element={<MyBetsPage />} />
          <Route path="pagos/resultado" element={<PaymentResultPage />} />
          {/* Protegida por sesion; el rol lo revisa la pagina (estado amable) y el BFF (403). */}
          <Route path="admin" element={<AdminPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
