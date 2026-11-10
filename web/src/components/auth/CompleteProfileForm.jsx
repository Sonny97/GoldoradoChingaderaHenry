import { useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import { useAsync } from '../../hooks/useAsync';
import * as authService from '../../services/authService';
import * as catalogService from '../../services/catalogService';
import { validateCompleteProfile, maxBirthDateIso } from '../../utils/validators';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/icons';
import { DOCUMENT_TYPES } from '../../utils/constants';

/**
 * Ficha de quien entro con Google o Microsoft.
 *
 * Son LOS MISMOS campos, iconos y reglas de RegisterForm, menos correo y
 * contraseña: el correo ya lo verifico el proveedor y la cuenta no tiene
 * clave. validateCompleteProfile reutiliza validateRegister por dentro, asi
 * que una regla nueva (por ejemplo la edad minima) llega a los dos.
 *
 * `onDone(user)` lo decide la pagina: aqui no se navega.
 */
export default function CompleteProfileForm({ onDone }) {
  const { user, replaceUser } = useAuth();
  const maxDob = maxBirthDateIso();

  const fetchTipos = useCallback(() => catalogService.getDocumentTypes(), []);
  const tipos = useAsync(fetchTipos, [], { initialData: DOCUMENT_TYPES });
  const tiposDocumento = tipos.data?.length ? tipos.data : DOCUMENT_TYPES;

  const form = useForm({
    initialValues: {
      name: user?.name ?? '',
      lastname: user?.lastname ?? '',
      documentType: user?.documentType || 'CC',
      documentNumber: user?.documentNumber ?? '',
      phone: user?.phone ?? '',
      birthDate: user?.birthDate ?? '',
      terms: false,
    },
    validate: validateCompleteProfile,
    onSubmit: async (values, helpers) => {
      const res = await authService.completeProfile(values);
      if (res.success) {
        replaceUser(res.data);
        onDone?.(res.data);
        return;
      }

      if (/documento/i.test(res.message)) helpers.setFieldError('documentNumber', res.message);
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
          Guardar y continuar
        </Button>
      </div>
    </form>
  );
}
