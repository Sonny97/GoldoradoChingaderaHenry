import { useState } from 'react';
import Input from './Input';
import Icon from './icons';

/**
 * Campo de contraseña con candado y ojo.
 *
 * El boton del ojo lleva type="button" EXPLICITO. Un <button> pelado dentro
 * de un <form> es type="submit" por defecto: hacer clic en el ojo enviaria el
 * formulario de login. Es el bug mas comun en exactamente esta pantalla.
 */
export default function PasswordInput({ label = 'Contraseña', ...rest }) {
  const [visible, setVisible] = useState(false);

  return (
    <Input
      label={label}
      type={visible ? 'text' : 'password'}
      icon={<Icon.Lock size={20} />}
      adornment={
        <button
          type="button"
          className="gd-field__adornment-btn"
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
        >
          {visible ? <Icon.EyeOff size={18} /> : <Icon.Eye size={18} />}
        </button>
      }
      {...rest}
    />
  );
}
