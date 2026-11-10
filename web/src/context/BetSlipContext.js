import { createContext } from 'react';

/**
 * Solo el contexto, ningun componente: misma razon que AuthContext (el Fast
 * Refresh de Vite degrada a recarga completa si un modulo mezcla ambos).
 *
 * El valor por defecto es `null` y NO undefined: a diferencia de useAuth, estar
 * fuera del provider no es un error. Una grilla de partidos montada sin
 * BetSlipProvider simplemente no abre el boleto y los chips se comportan como
 * antes.
 */
export const BetSlipContext = createContext(null);
