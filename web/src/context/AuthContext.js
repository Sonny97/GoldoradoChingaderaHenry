import { createContext } from 'react';

/**
 * Este archivo exporta SOLO el contexto, ningun componente.
 *
 * Es deliberado: el Fast Refresh de Vite degrada silenciosamente a recarga
 * completa de pagina cuando un modulo exporta a la vez un componente y algo
 * que no lo es. Con formularios eso se sufre en cada tecla.
 *
 * El valor por defecto es `undefined` y no `null` para que useAuth pueda
 * distinguir "estas fuera del provider" de "no hay sesion".
 */
export const AuthContext = createContext(undefined);
