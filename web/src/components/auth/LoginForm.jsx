import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useForm } from '../../hooks/useForm';
import { validateLogin } from '../../utils/validators';
import Input from '../ui/Input';
import PasswordInput from '../ui/PasswordInput';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Icon from '../ui/icons';
import { ROUTES } from '../../utils/constants';

export default function LoginForm({ initialUsername = '' }) {
  const { login } = useAuth();
  const [remember, setRemember] = useState(true);

  const form = useForm({
    initialValues: { username: initialUsername, password: '' },
    validate: validateLogin,
    onSubmit: async (values, helpers) => {
      const res = await login(values);
      if (!res.success) {
        helpers.setSubmitError(res.message);
      }
      // Con exito NO navegamos aqui. En cuanto `user` deja de ser null,
      // GuestRoute re-renderiza y emite el <Navigate>. Si el formulario
      // tambien navegara habria dos navegaciones compitiendo en el mismo
      // commit y aterrizajes ocasionalmente equivocados.
    },
  });

  return (
    <form className="gd-auth-form" onSubmit={form.handleSubmit} noValidate>
      <Input
        label="Usuario"
        name="username"
        placeholder="Tu correo o documento"
        autoComplete="username"
        icon={<Icon.User size={20} />}
        value={form.values.username}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.showError('username')}
      />

      <PasswordInput
        name="password"
        placeholder="••••••••"
        autoComplete="current-password"
        value={form.values.password}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.showError('password')}
      />

      <div className="gd-auth-form__row">
        <label className="gd-check">
          <input
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span className="gd-check__box" aria-hidden="true">
            <Icon.Check size={12} />
          </span>
          <span>Recordarme</span>
        </label>

        {/* El username tecleado viaja en el state del enlace: asi la pantalla
            de recuperacion puede mostrar ****@hotmail.com de entrada, como en
            el boceto, sin agregar un paso extra. */}
        <Link
          className="gd-link-gold"
          to={ROUTES.RECOVER}
          state={{ username: form.values.username }}
        >
          ¿Ha olvidado su contraseña?
        </Link>
      </div>

      {form.submitError ? <Alert variant="error">{form.submitError}</Alert> : null}

      <Button type="submit" variant="gold" size="lg" full loading={form.isSubmitting}>
        Entrar
      </Button>
    </form>
  );
}
