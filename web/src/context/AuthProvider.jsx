import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AuthContext } from './AuthContext';
import * as authService from '../services/authService';
import { guardarToken } from '../services/http';
import { STORAGE_KEYS } from '../utils/constants';

/**
 * Provider de autenticacion.
 *
 * No llama ningun hook de router a proposito: asi queda independiente del
 * orden de montaje respecto a <BrowserRouter>.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // ARRANCA EN TRUE. Este es el nucleo de la defensa contra el
  // flash-redirect: si empezara en false, el primer render tendria
  // user===null con el efecto sin correr, y ProtectedRoute expulsaria a
  // /login a un usuario que si tiene sesion.
  const [isLoading, setIsLoading] = useState(true);

  const userRef = useRef(null);
  userRef.current = user;

  // Bootstrap: lee la sesion persistida exactamente una vez.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await authService.getCurrentUser();
      if (cancelled) return; // guarda contra el doble efecto de StrictMode
      setUser(res.success ? res.data : null);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sincroniza el cierre de sesion entre pestañas.
  useEffect(() => {
    function onStorage(event) {
      if (event.key !== STORAGE_KEYS.SESSION) return;
      authService.getCurrentUser().then((res) => {
        setUser(res.success ? res.data : null);
      });
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const login = useCallback(async (credentials) => {
    const res = await authService.login(credentials);
    if (res.success) setUser(res.data.user);
    return res; // el caller recibe el sobre completo para el mensaje de error
  }, []);

  const register = useCallback(async (values) => {
    const res = await authService.register(values);
    if (res.success) setUser(res.data.user); // auto-login tras registro
    return res;
  }, []);

  const logout = useCallback(async () => {
    const res = await authService.logout();
    setUser(null);
    return res;
  }, []);

  /**
   * Vuelve a leer /auth/me. Lo usan las pantallas que cambian el saldo o la
   * ficha por fuera del provider (una apuesta, un pago aprobado, la foto): el
   * backend es la fuente de verdad y aqui no se recalcula nada a mano.
   *
   * Si la lectura falla por red NO se cierra la sesion: readCurrentUser no
   * toca el token, y solo un 401 (que http.js ya limpio) deja user en null
   * para que los guards hagan su trabajo.
   */
  const refreshUser = useCallback(async () => {
    const res = await authService.readCurrentUser();
    if (res.success) setUser(res.data);
    else if (!authService.hasSession()) setUser(null);
    return res;
  }, []);

  /**
   * Entrada con Google o Microsoft: el token llega en el fragmento de
   * /auth/callback. Se guarda en el mismo lugar que el de un login normal y se
   * pide el perfil completo, porque el fragmento no trae al usuario.
   */
  const loginWithToken = useCallback(async (token) => {
    if (!token) return { success: false, data: null, message: 'No recibimos tu sesión' };
    guardarToken(token);
    const res = await authService.getCurrentUser();
    setUser(res.success ? res.data : null);
    return res;
  }, []);

  /** Cierra la sesion aqui y en todos los demas dispositivos. */
  const logoutAll = useCallback(async () => {
    const res = await authService.logoutAll();
    if (res.success) setUser(null);
    return res;
  }, []);

  /** Para quien ya tiene el usuario nuevo en la mano (foto, completar perfil). */
  const replaceUser = useCallback((nextUser) => {
    if (nextUser) setUser(nextUser);
  }, []);

  const updateUser = useCallback(async (patch) => {
    const id = userRef.current?.id;
    if (!id) return { success: false, data: null, message: 'No hay sesión activa' };
    const res = await authService.updateProfile(id, patch);
    if (res.success) setUser(res.data);
    return res;
  }, []);

  // useMemo obligatorio: sin el, cada render del provider entrega un objeto
  // nuevo a Navbar, ambos guards y todos los formularios.
  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
      logoutAll,
      updateUser,
      refreshUser,
      loginWithToken,
      replaceUser,
    }),
    [user, isLoading, login, register, logout, logoutAll, updateUser, refreshUser, loginWithToken, replaceUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
