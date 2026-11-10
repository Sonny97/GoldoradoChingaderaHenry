import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useForm } from '../hooks/useForm';
import * as authService from '../services/authService';
import Card from '../components/ui/Card';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Alert from '../components/ui/Alert';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/icons';
import { validateProfileEdit } from '../utils/validators';
import { formatDate } from '../utils/format';
import { AVATAR_TYPES, AVATAR_MAX_BYTES } from '../utils/constants';

const PROVEEDORES = [
  { code: 'GOOGLE', name: 'Google', Glyph: Icon.Google },
  { code: 'MICROSOFT', name: 'Microsoft', Glyph: Icon.Microsoft },
];

/**
 * /perfil: foto, datos editables, cuentas vinculadas y cierre de sesion global.
 */
export default function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <section className="gd-section gd-container gd-profile">
      <header className="gd-page-head">
        <span className="gd-eyebrow">
          <span className="gd-eyebrow__dot" />
          Tu cuenta
        </span>
        <h1 className="gd-section__title">Mi perfil</h1>
      </header>

      <div className="gd-profile__grid">
        <AvatarCard />
        <PersonalDataCard />
        <LinkedAccountsCard />
        <SecurityCard />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- foto */

/**
 * La foto se valida AQUI antes de subirla (tipo y tamaño) para no gastar una
 * subida de 5 MB por una red movil y recibir un 400 al final. El BFF vuelve a
 * validar: lo de aqui es cortesia, no seguridad.
 *
 * La vista previa usa URL.createObjectURL y se revoca en el cleanup del efecto:
 * cada objectURL retiene el archivo en memoria hasta que se libera.
 */
function AvatarCard() {
  const { user, replaceUser } = useAuth();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function resetPicker() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handlePick(event) {
    const picked = event.target.files?.[0];
    setError('');
    setMessage('');
    if (!picked) return;

    if (!AVATAR_TYPES.includes(picked.type)) {
      setError('La foto debe ser PNG, JPG o WEBP');
      resetPicker();
      return;
    }
    if (picked.size > AVATAR_MAX_BYTES) {
      setError('La foto no puede pesar más de 5 MB');
      resetPicker();
      return;
    }
    setFile(picked);
  }

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setError('');
    const res = await authService.uploadAvatar(file);
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'No pudimos subir tu foto');
      return;
    }
    replaceUser(res.data);
    resetPicker();
    setMessage('Tu foto de perfil se actualizó');
  }

  async function handleRemove() {
    setBusy(true);
    setError('');
    setMessage('');
    const res = await authService.removeAvatar();
    setBusy(false);
    if (!res.success) {
      setError(res.message || 'No pudimos quitar tu foto');
      return;
    }
    replaceUser(res.data);
    setMessage('Quitamos tu foto de perfil');
  }

  return (
    <Card padding="lg" gold className="gd-profile__card gd-profile__card--avatar">
      <div className="gd-profile__avatar-wrap">
        {preview ? (
          <span className="gd-avatar gd-avatar--photo" style={{ '--gd-avatar-size': '112px' }}>
            <img className="gd-avatar__img" src={preview} alt="Vista previa de tu nueva foto" />
          </span>
        ) : (
          <Avatar user={user} size={112} />
        )}
      </div>

      <div className="gd-profile__identity">
        <h2 className="gd-profile__name">{user.fullName}</h2>
        <p className="gd-profile__email">{user.email}</p>
      </div>

      {/* El input real queda oculto pero accesible: el <label> lo activa con
          clic y con teclado, sin un boton falso que llame a .click(). */}
      <input
        ref={inputRef}
        id="gd-avatar-file"
        className="gd-sr-only"
        type="file"
        accept={AVATAR_TYPES.join(',')}
        onChange={handlePick}
      />

      <div className="gd-profile__avatar-actions">
        {file ? (
          <>
            <Button variant="gold" size="sm" loading={busy} onClick={handleUpload}>
              Guardar foto
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={resetPicker}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <label htmlFor="gd-avatar-file" className="gd-btn gd-btn--outline gd-btn--sm gd-profile__file-btn">
              <Icon.Camera size={16} />
              {user.avatarUrl ? 'Cambiar foto' : 'Subir foto'}
            </label>
            {user.avatarUrl ? (
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                iconLeft={<Icon.Trash size={16} />}
                onClick={handleRemove}
              >
                Quitar foto
              </Button>
            ) : null}
          </>
        )}
      </div>

      <p className="gd-profile__hint">PNG, JPG o WEBP de máximo 5 MB.</p>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {message ? <Alert variant="success">{message}</Alert> : null}
    </Card>
  );
}

/* ------------------------------------------------------- datos personales */

/**
 * Solo nombre, apellido y telefono son editables (PATCH /auth/perfil). El
 * documento y la fecha de nacimiento identifican legalmente al apostador y se
 * muestran de solo lectura: cambiarlos es un tramite con soporte, no un campo.
 */
function PersonalDataCard() {
  const { user, updateUser } = useAuth();
  const [saved, setSaved] = useState(false);

  const form = useForm({
    initialValues: {
      name: user?.name ?? '',
      lastname: user?.lastname ?? '',
      phone: user?.phone ?? '',
    },
    validate: validateProfileEdit,
    onSubmit: async (values, helpers) => {
      setSaved(false);
      const res = await updateUser(values);
      if (!res.success) {
        helpers.setSubmitError(res.message);
        return;
      }
      setSaved(true);
    },
  });

  return (
    <Card padding="lg" className="gd-profile__card">
      <h2 className="gd-profile__card-title">Datos personales</h2>

      <form className="gd-profile__form" onSubmit={form.handleSubmit} noValidate>
        <div className="gd-form-grid">
          <Input
            label="Nombre"
            name="name"
            autoComplete="given-name"
            required
            icon={<Icon.User size={20} />}
            value={form.values.name}
            onChange={(e) => {
              setSaved(false);
              form.handleChange(e);
            }}
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
            onChange={(e) => {
              setSaved(false);
              form.handleChange(e);
            }}
            onBlur={form.handleBlur}
            error={form.showError('lastname')}
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
            onChange={(e) => {
              setSaved(false);
              form.handleChange(e);
            }}
            onBlur={form.handleBlur}
            error={form.showError('phone')}
          />
        </div>

        <dl className="gd-profile__readonly">
          <div>
            <dt>Correo</dt>
            <dd>{user?.email || '—'}</dd>
          </div>
          <div>
            <dt>Documento</dt>
            <dd>{user?.documentNumber ? `${user.documentType} ${user.documentNumber}` : '—'}</dd>
          </div>
          <div>
            <dt>Fecha de nacimiento</dt>
            <dd>{user?.birthDate ? formatDate(`${user.birthDate}T12:00:00`) : '—'}</dd>
          </div>
        </dl>

        {form.submitError ? <Alert variant="error">{form.submitError}</Alert> : null}
        {saved ? <Alert variant="success">Perfil actualizado</Alert> : null}

        <div className="gd-profile__actions">
          <Button type="submit" variant="gold" loading={form.isSubmitting}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------- cuentas externas */

function LinkedAccountsCard() {
  const { user } = useAuth();
  const linked = (user?.providers ?? []).map((p) => String(p).toUpperCase());

  return (
    <Card padding="lg" className="gd-profile__card">
      <h2 className="gd-profile__card-title">Cuentas vinculadas</h2>
      <ul className="gd-profile__providers">
        {PROVEEDORES.map(({ code, name, Glyph }) => {
          const isLinked = linked.includes(code);
          return (
            <li key={code} className="gd-profile__provider">
              <Glyph size={22} />
              <span className="gd-profile__provider-name">{name}</span>
              {isLinked ? (
                <Badge variant="win">Vinculada</Badge>
              ) : (
                <Badge variant="neutral">No vinculada</Badge>
              )}
            </li>
          );
        })}
      </ul>
      <p className="gd-profile__hint">
        {user?.hasPassword === false
          ? 'Tu cuenta no tiene contraseña: entras solo con tu cuenta externa.'
          : 'También puedes entrar con tu correo o documento y tu contraseña.'}
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------- seguridad */

/**
 * Cierra TODAS las sesiones, incluida esta. Al quedar user en null,
 * ProtectedRoute manda a /login con from=/perfil: tras volver a entrar, el
 * usuario aterriza otra vez aqui, que es justo donde estaba.
 */
function SecurityCard() {
  const { logoutAll } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = useCallback(() => {
    if (!busy) setConfirming(false);
  }, [busy]);

  async function handleConfirm() {
    setBusy(true);
    setError('');
    const res = await logoutAll();
    // Si salio bien, este componente ya se esta desmontando.
    if (!res.success) {
      setBusy(false);
      setError(res.message || 'No pudimos cerrar tus sesiones');
    }
  }

  return (
    <Card padding="lg" className="gd-profile__card">
      <h2 className="gd-profile__card-title">Seguridad</h2>
      <p className="gd-profile__text">
        ¿Usaste GolDorado en un computador prestado o perdiste tu celular? Cierra la sesión en
        todos los dispositivos donde hayas entrado, incluido este.
      </p>
      <Button variant="danger" iconLeft={<Icon.Devices size={16} />} onClick={() => setConfirming(true)}>
        Cerrar sesión en todos los dispositivos
      </Button>

      <Modal
        open={confirming}
        onClose={close}
        title="¿Cerrar todas tus sesiones?"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={close} data-autofocus>
              Cancelar
            </Button>
            <Button variant="danger" loading={busy} onClick={handleConfirm}>
              Sí, cerrar todas
            </Button>
          </>
        }
      >
        <p>Tendrás que volver a iniciar sesión en este y en todos tus otros dispositivos.</p>
        {error ? <Alert variant="error">{error}</Alert> : null}
      </Modal>
    </Card>
  );
}
