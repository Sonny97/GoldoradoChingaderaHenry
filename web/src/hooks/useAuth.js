import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Acceso al estado de autenticacion.
 *
 * El throw explicito convierte un error de montaje en un mensaje claro, en
 * vez del "Cannot read properties of null" que aparecería tres componentes
 * mas abajo.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}
