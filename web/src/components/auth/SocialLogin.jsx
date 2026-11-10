import { useCallback } from 'react';
import { useAsync } from '../../hooks/useAsync';
import * as authService from '../../services/authService';
import Icon from '../ui/icons';
import { ROUTES } from '../../utils/constants';

/**
 * Valor inicial mientras llega /auth/proveedores: los dos botones ya se ven
 * (deshabilitados) y la tarjeta no salta cuando la respuesta aterriza. Va a
 * nivel de modulo porque useAsync congela initialData del primer render.
 */
const PROVEEDORES_INICIALES = [
  { code: 'GOOGLE', name: 'Google', enabled: false },
  { code: 'MICROSOFT', name: 'Microsoft', enabled: false },
];

const GLYPHS = {
  GOOGLE: Icon.Google,
  MICROSOFT: Icon.Microsoft,
};

/**
 * "Continuar con Google / Microsoft".
 *
 * Es una NAVEGACION de pagina completa (window.location.assign), no un fetch:
 * el BFF contesta 302 hacia el proveedor y deja una cookie firmada con state,
 * nonce y code_verifier. Esa cookie y esa redireccion solo funcionan si el
 * navegador va de verdad a /api/auth/oauth/<proveedor>.
 *
 * `from` es a donde queria ir el usuario antes de que ProtectedRoute lo mandara
 * a /login; viaja como `destino` y vuelve en el fragmento de /auth/callback.
 *
 * Un proveedor sin llaves en el servidor llega con enabled=false y se pinta
 * deshabilitado con el title "No configurado", en vez de desaparecer.
 */
export default function SocialLogin({ from }) {
  const fetchProviders = useCallback(() => authService.getProviders(), []);
  const providers = useAsync(fetchProviders, [], { initialData: PROVEEDORES_INICIALES });
  const list = providers.data?.length ? providers.data : PROVEEDORES_INICIALES;

  const destino = from || ROUTES.DASHBOARD;

  return (
    <div className="gd-social-login" role="group" aria-label="Continuar con una cuenta externa">
      {list.map((provider) => {
        const code = String(provider.code).toUpperCase();
        const Glyph = GLYPHS[code] ?? Icon.User;
        const enabled = Boolean(provider.enabled) && !providers.isLoading;

        return (
          <button
            key={code}
            type="button"
            className="gd-social-btn"
            disabled={!enabled}
            title={!providers.isLoading && !provider.enabled ? 'No configurado' : undefined}
            onClick={() => window.location.assign(authService.oauthStartUrl(code, destino))}
          >
            <Glyph size={20} />
            <span>Continuar con {provider.name}</span>
          </button>
        );
      })}
    </div>
  );
}
