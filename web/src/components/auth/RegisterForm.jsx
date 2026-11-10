import { useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import { useAsync } from '../../hooks/useAsync';
import * as catalogService from '../../services/catalogService';
import { validateRegister, maxBirthDateIso } from '../../utils/validators';
import Input from '../ui/Input';
import PasswordInput from '../ui/PasswordInput';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import PasswordStrength from '../ui/PasswordStrength';
import Icon from '../ui/icons';
import { DOCUMENT_TYPES } from '../../utils/constants';

/**
 * Formulario "Crear cuenta" del boceto: dos columnas con el medidor de fuerza
 * bajo la contraseña.
 */
export default function RegisterForm() {
  const { register } = useAuth();
  const maxDob = maxBirthDateIso();

  /**
   * Los tipos de documento salen de la tabla Tipo_Documento.
   *
   * `initialData` es la lista de constants.js: mientras llega la respuesta el
   * <select> ya tiene opciones, asi que no parpadea vacio ni deja al usuario
   * sin poder elegir. Si el API falla, useAsync restaura ese mismo respaldo y
   * el formulario sigue siendo utilizable.
   */
  const fetchTipos = useCallback(() => catalogService.getDocumentTypes(), []);
  const tipos = useAsync(fetchTipos, [], { initialData: DOCUMENT_TYPES });
  const tiposDocumento = tipos.data?.length ? tipos.data : DOCUMENT_TYPES;

  const form = useForm({
    initialValues: {
      name: '',
      lastname: '',
      email: '',
      password: '',
      documentType: 'CC',
      documentNumber: '',
      phone: '',
      birthDate: '',
      terms: false,
    },
    validate: validateRegister,
    onSubmit: async (values, helpers) => {
      const res = await register(values);
      if (res.success) return; // GuestRoute se encarga de navegar

      // Los conflictos se anclan al campo culpable, no a un banner generico:
      // asi el usuario ve exactamente que corregir.
      if (/correo/i.test(res.message)) helpers.setFieldError('email', res.message);
      else if (/documento/i.test(res.message)) helpers.setFieldError('documentNumber', res.message);
      else helpers.setSubmitError(res.message);
    },
  });

  return (
    <form className="gd-register__form" onSubmit={form.handleSubmit} noValidate>
      <div className="gd-form-grid">
        <Input
          label="Nombre"
          name="name"
          autoComplete="given-name"
          required
          icon={<Icon.User size={20} />}
          value={form.values.name}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('name')}
        />

        <Input
          label="Apellido"
          name="lastname"
          autoComplete="family-name"
          required
          icon={<Icon.User size={20} />}
          value={form.values.lastname}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('lastname')}
        />

        <Input
          label="Correo electrónico"
          name="email"
          type="email"
          autoComplete="email"
          required
          icon={<Icon.Mail size={20} />}
          value={form.values.email}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('email')}
        />

        <div className="gd-form-grid__cell">
          <PasswordInput
            name="password"
            /* autoComplete="new-password" es obligatorio: sin el, Chrome
               autocompleta la contraseña guardada del login y el medidor de
               fuerza miente. */
            autoComplete="new-password"
            required
            value={form.values.password}
            onChange={form.handleChange}
            onBlur={form.handleBlur}
            error={form.showError('password')}
          />
          <PasswordStrength value={form.values.password} />
        </div>

        <Select
          label="Tipo de documento"
          name="documentType"
          required
          options={tiposDocumento}
          icon={<Icon.IdCard size={20} />}
          value={form.values.documentType}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('documentType')}
        />

        <Input
          label="Número de documento"
          name="documentNumber"
          /* type="text" + inputMode, NUNCA type="number": ese acepta 'e',
             '+' y '-', come ceros a la izquierda, y la rueda del mouse
             cambia el valor mientras el usuario hace scroll. */
          inputMode="numeric"
          sanitize="digits"
          maxLength={15}
          required
          icon={<Icon.IdCard size={20} />}
          value={form.values.documentNumber}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('documentNumber')}
        />

        <Input
          label="Teléfono"
          name="phone"
          type="tel"
          inputMode="numeric"
          sanitize="digits"
          maxLength={15}
          autoComplete="tel"
          required
          icon={<Icon.Phone size={20} />}
          value={form.values.phone}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('phone')}
        />

        <Input
          label="Fecha de nacimiento"
          name="birthDate"
          type="date"
          autoComplete="bday"
          required
          /* `max` hace que el selector nativo ya impida elegir a un menor. */
          max={maxDob}
          icon={<Icon.Calendar size={20} />}
          value={form.values.birthDate}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('birthDate')}
        />
      </div>

      <label className="gd-check gd-check--start gd-register__terms">
        <input
          type="checkbox"
          name="terms"
          checked={form.values.terms}
          onChange={form.handleChange}
        />
        <span className="gd-check__box" aria-hidden="true">
          <Icon.Check size={12} />
        </span>
        <span>
          Soy mayor de 18 años y acepto los términos y la política de privacidad de GolDorado.
        </span>
      </label>

      {form.showError('terms') ? (
        <p className="gd-field__error" role="alert">
          <Icon.Alert size={14} />
          {form.showError('terms')}
        </p>
      ) : null}

      {form.submitError ? <Alert variant="error">{form.submitError}</Alert> : null}

      <div className="gd-register__actions">
        <Button type="submit" variant="gold" size="lg" pill loading={form.isSubmitting}>
          Crear cuenta
        </Button>
      </div>
    </form>
  );
}
