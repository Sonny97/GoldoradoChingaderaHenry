import ScrollToTop from './components/layout/ScrollToTop';
import AppRoutes from './routes/AppRoutes';
import { BetSlipProvider } from './context/BetSlipProvider';

/**
 * BetSlipProvider va aqui y no en main.jsx: usa useNavigate, asi que tiene que
 * quedar dentro de <BrowserRouter>, y necesita useAuth, asi que dentro de
 * <AuthProvider>. App es el primer punto donde se cumplen las dos cosas.
 */
export default function App() {
  return (
    <BetSlipProvider>
      <ScrollToTop />
      <AppRoutes />
    </BetSlipProvider>
  );
}
