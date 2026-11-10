import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Carga de datos consciente del sobre { success, data, message }.
 *
 *   const { data, error, isLoading, reload } = useAsync(
 *     () => matchService.getMatches({ status }),
 *     [status],
 *     { initialData: [] }
 *   );
 *
 * Dos protecciones que no son opcionales:
 *
 * 1. La funcion vive en un ref y solo se re-ejecuta por `deps`. Todo caller
 *    escribe una arrow inline, que cambia de identidad en cada render: si
 *    estuviera en el array de dependencias, el efecto entraria en bucle.
 *
 * 2. Guarda de respuestas fuera de orden (requestId). Al hacer clic rapido
 *    entre categorias, una respuesta lenta anterior puede aterrizar DESPUES
 *    de una rapida posterior y pintar la lista equivocada. Con la latencia
 *    aleatoria de los servicios esto es genuinamente reproducible.
 */
export function useAsync(asyncFn, deps = [], { initialData = null, skip = false } = {}) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(!skip);

  const fnRef = useRef(asyncFn);
  fnRef.current = asyncFn;

  const requestId = useRef(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;

    setIsLoading(true);
    setError('');

    try {
      const res = await fnRef.current();

      // Descarta cualquier resolucion que no sea la ultima disparada.
      if (!isMounted.current || id !== requestId.current) return;

      if (res && res.success) {
        setData(res.data);
      } else {
        setData(initialData);
        setError(res?.message || 'No pudimos cargar la información');
      }
    } catch {
      if (!isMounted.current || id !== requestId.current) return;
      setData(initialData);
      setError('No pudimos cargar la información');
    } finally {
      if (isMounted.current && id === requestId.current) setIsLoading(false);
    }
    // initialData se congela del primer render: si fuera dependencia, un
    // literal `[]` inline dispararia el efecto en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (skip) {
      setIsLoading(false);
      return;
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, skip]);

  return { data, error, isLoading, reload: run };
}
