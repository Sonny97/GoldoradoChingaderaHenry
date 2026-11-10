import { useContext } from 'react';
import { BetSlipContext } from '../context/BetSlipContext';

/**
 * { openBetSlip(match, odd), activeOdd } o null fuera del provider.
 * No lanza: ver el comentario de BetSlipContext.
 */
export function useBetSlip() {
  return useContext(BetSlipContext);
}
