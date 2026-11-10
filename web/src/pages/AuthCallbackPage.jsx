import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AuthLayout from '../components/layout/AuthLayout';
import Card from '../components/ui/Card';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import { LogoMark } from '../components/layout/Wordmark';
import { ROUTES } from '../utils/constants';

/** Solo rutas internas: '/inicio' si, 'https://otro.sitio' o '//otro.sitio' no. */
function destinoSeguro(valor) {
  return typeof valor === 'string' && valor.startsWith('/') && !valor.startsWith('//')
    ? valor
    : ROUTES.DASHBOARD;
}

/** '#token=...&nuevo=1&destino=/inicio' -> { token, nuevo, destino, error } */
function leerFragmento() {
  const parametros = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    token: parametros.get('token') || '',
    nuevo: parametros.get('nuevo') === '1',
    destino: destinoSeguro(parametros.get('destino')),
    error: parametros.get('error') || '',
  };
}

/**
 * Regreso de Google / Microsoft.
 *
 * El BFF deja el token en el FRAGMENTO (#token=...), que el navegador nunca
 * manda a ningun servidor, ni aparece en logs ni en el Referer. Aun asi no debe
 * quedarse en la barra de direcciones: se borra con history.replaceState en
 * cuanto se lee, antes de cualquier otra cosa, para que no termine en el
 * historial, en un marcador o en una captura de pantalla.
 *
 * El fragmento se lee en el inicializador de useState y no dentro del efecto:
 * en StrictMode el efecto corre dos veces, y la segunda ya encontraria la URL
 * limpia y mostraria un error falso.
 *
 * El doble efecto llama dos veces a loginWithToken con el mismo token, y eso
 * es inofensivo (guarda lo mismo, lee el mismo /auth/me). Lo que NO se hace es
 * protegerlo con un ref de "ya corri": con la bandera `cancelled` del primer
 * efecto, el segundo seria el unico capaz de navegar, y el ref lo saltaria.
 *
 * No vive bajo GuestRoute: ver el comentario en AppRoutes.
 */
export default function AuthCallbackPage() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [fragment] = useState(leerFragmento);
  const [error, setError] = useState(
    fragment.error || (fragment.token ? '' : 'No recibimos tu sesión. Intenta iniciar sesión de nuevo.')
  );

  useEffect(() => {
    // Primero se limpia la URL, pase lo que pase despues.
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    if (!fragment.token || fragment.error) return undefined;

    let cancelled = false;

    (async () => {
      const res = await loginWithToken(fragment.token);
      if (cancelled) return;

      if (!res.success) {
        setError(res.message || 'No pudimos iniciar tu sesión. Intenta de nuevo.');
        return;
      }

      // Quien entro con Google o Microsoft y todavia no tiene documento,
      // telefono ni fecha de nacimiento no puede apostar ni recargar: se le
      // pide la ficha primero y despues se le devuelve a su destino.
      if (res.data?.profileComplete === false) {
        navigate(ROUTES.COMPLETE_PROFILE, {
          replace: true,
          state: { from: { pathname: fragment.destino }, nuevo: fragment.nuevo },
        });
        return;
      }

      navigate(fragment.destino, { replace: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [fragment, loginWithToken, navigate]);

  return (
    <AuthLayout>
      <Card className="gd-auth-card" padding="lg" gold>
        <div className="gd-auth-card__avatar">
          <LogoMark size={52} />
        </div>

        {error ? (
          <>
            <h1 className="gd-auth-card__title">No pudimos iniciar sesión</h1>
            <Alert variant="error">{error}</Alert>
            <div className="gd-callback__actions">
              <Button as={Link} to={ROUTES.LOGIN} variant="gold" size="lg" full>
                Volver a iniciar sesión
              </Button>
            </div>
          </>
        ) : (
          <div className="gd-callback__state" aria-live="polite">
            <Spinner size={40} label="Iniciando sesión" />
            <h1 className="gd-auth-card__title">Iniciando sesión…</h1>
            <p className="gd-auth-card__sub">Estamos verificando tu cuenta, un momento.</p>
          </div>
        )}
      </Card>
    </AuthLayout>
  );
}
