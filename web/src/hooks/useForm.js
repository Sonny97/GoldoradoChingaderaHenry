import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Maquina de estado de formulario.
 *
 * Se paga sola repartida entre los cuatro formularios de la app (Login,
 * Registro, Identificar, Nueva contraseña). Sin ella cada uno repetiria
 * values/errors/touched/isSubmitting y sus handlers, y arreglar la logica de
 * `touched` en uno significaria olvidarla en los otros tres.
 *
 *   const form = useForm({ initialValues, validate, onSubmit });
 *
 * `validate(values)` devuelve un mapa { campo: 'mensaje' }. Un solo validate
 * en vez de esquemas por campo cubre gratis las reglas cruzadas
 * (confirm === password).
 */
export function useForm({ initialValues = {}, validate, onSubmit }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const runValidate = useCallback(
    (next) => (typeof validate === 'function' ? validate(next) ?? {} : {}),
    [validate]
  );

  const handleChange = useCallback(
    (event) => {
      const target = event.target;
      const { name, type } = target;

      // Sin `name` en el DOM, `values` nunca se actualiza y todo PARECE
      // cableado. Avisamos alto en desarrollo.
      if (import.meta.env.DEV && !name) {
        console.warn('[useForm] Un campo cambio sin atributo `name`. Revisa el <Input>.');
        return;
      }

      let value;
      if (type === 'checkbox') value = target.checked;
      else value = target.value;

      // Sanitizador opcional por campo: data-sanitize="digits" en el input.
      if (type !== 'checkbox' && target.dataset?.sanitize === 'digits') {
        value = String(value).replace(/\D/g, '');
      }

      setValues((prev) => {
        const next = { ...prev, [name]: value };
        // Revalida en vivo solo si el campo ya fue tocado o ya se intento
        // enviar: mostrar "correo invalido" en la primera tecla es hostil.
        if (touched[name] || submitAttempted) {
          setErrors(runValidate(next));
        }
        return next;
      });

      setSubmitError('');
    },
    [runValidate, touched, submitAttempted]
  );

  const handleBlur = useCallback(
    (event) => {
      const { name } = event.target;
      if (!name) return;
      setTouched((prev) => ({ ...prev, [name]: true }));
      setErrors(runValidate(values));
    },
    [runValidate, values]
  );

  const setFieldValue = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const setFieldError = useCallback((name, message) => {
    setErrors((prev) => ({ ...prev, [name]: message }));
    setTouched((prev) => ({ ...prev, [name]: true }));
  }, []);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
    setSubmitError('');
    setSubmitAttempted(false);
    setIsSubmitting(false);
    // initialValues se toma solo del primer render a proposito: pasarlo como
    // dependencia haria que un objeto literal inline reiniciara el form en
    // cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(
    async (event) => {
      if (event?.preventDefault) event.preventDefault();

      setSubmitAttempted(true);
      setSubmitError('');

      const allTouched = Object.keys(values).reduce(
        (acc, key) => ({ ...acc, [key]: true }),
        {}
      );
      setTouched(allTouched);

      const nextErrors = runValidate(values);
      setErrors(nextErrors);

      const firstInvalid = Object.keys(nextErrors)[0];
      if (firstInvalid) {
        // Enfoca el primer campo con error: sin esto, en un formulario largo
        // el usuario no sabe donde esta el problema.
        requestAnimationFrame(() => {
          const node = document.querySelector(`[name="${firstInvalid}"]`);
          if (node && typeof node.focus === 'function') node.focus();
        });
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit?.(values, { setFieldError, setSubmitError, reset });
      } finally {
        if (isMounted.current) setIsSubmitting(false);
      }
    },
    [values, runValidate, onSubmit, setFieldError, reset]
  );

  /** Un error solo se muestra si el campo fue tocado o ya se intento enviar. */
  const showError = useCallback(
    (name) => (touched[name] || submitAttempted ? errors[name] || '' : ''),
    [touched, submitAttempted, errors]
  );

  return {
    values,
    errors,
    touched,
    isSubmitting,
    submitAttempted,
    submitError,
    isValid: Object.keys(errors).length === 0,
    handleChange,
    handleBlur,
    handleSubmit,
    showError,
    setValues,
    setFieldValue,
    setFieldError,
    setSubmitError,
    reset,
  };
}
