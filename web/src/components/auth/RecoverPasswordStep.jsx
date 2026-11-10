import { useForm } from '../../hooks/useForm';
import { validateNewPassword } from '../../utils/validators';
import PasswordInput from '../ui/PasswordInput';
import PasswordStrength from '../ui/PasswordStrength';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/icons';

/** Paso 3: nueva contraseña + confirmacion. */
export default function RecoverPasswordStep({ onSave, onCancel, error = '' }) {
  const form = useForm({
    initialValues: { password: '', confirm: '' },
    validate: validateNewPassword,
    onSubmit: async (values, helpers) => {
      const res = await onSave(values.password);
      if (res && !res.success) helpers.setSubmitError(res.message);
    },
  });

  return (
    <form className="gd-auth-form" onSubmit={form.handleSubmit} noValidate>
      <p className="gd-auth-card__sub">
        Debe tener al menos 8 caracteres, una mayúscula, un número y un símbolo.
      </p>

      <div className="gd-form-grid__cell">
        <PasswordInput
          label="Nueva contraseña"
          name="password"
          autoComplete="new-password"
          value={form.values.password}
          onChange={form.handleChange}
          onBlur={form.handleBlur}
          error={form.showError('password')}
        />
        <PasswordStrength value={form.values.password} />
      </div>

      <PasswordInput
        label="Confirmar contraseña"
        name="confirm"
        autoComplete="new-password"
        value={form.values.confirm}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.showError('confirm')}
      />

      {(form.submitError || error) ? (
        <Alert variant="error">{form.submitError || error}</Alert>
      ) : null}

      <div className="gd-recover__actions">
        <Button
          variant="outline"
          size="lg"
          iconLeft={<Icon.ArrowLeft size={18} />}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button type="submit" variant="gold" size="lg" loading={form.isSubmitting}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
