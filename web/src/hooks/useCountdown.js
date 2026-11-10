import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Cuenta regresiva en segundos, para el cooldown de reenvio del OTP.
 *
 * El intervalo se limpia siempre en el cleanup: un timer sobreviviente
 * dispararia setState sobre un componente desmontado.
 */
export function useCountdown(initialSeconds = 0) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (seconds <= 0) {
      clear();
      return undefined;
    }

    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return clear;
  }, [seconds > 0, clear]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = useCallback((value) => {
    clear();
    setSeconds(value);
  }, [clear]);

  return { seconds, isRunning: seconds > 0, start, stop: () => setSeconds(0) };
}
