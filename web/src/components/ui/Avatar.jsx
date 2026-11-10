import { useState } from 'react';
import { getInitials } from '../../utils/format';

/**
 * Avatar circular: la foto de perfil (ms-imagenes) si existe, las iniciales
 * sobre dorado si no.
 *
 * El fallo de carga se recuerda POR URL y no con un booleano: si el usuario
 * sube una foto nueva despues de que la anterior fallara, la nueva URL vuelve a
 * intentarse sin necesitar un efecto que reinicie el estado.
 *
 * Sigue siendo aria-hidden: el nombre siempre esta escrito al lado, y leerlo
 * dos veces seguidas solo estorba al lector de pantalla.
 */
export default function Avatar({ user, size = 36, className = '' }) {
  const initials = getInitials(user?.name, user?.lastname);
  const url = user?.avatarUrl || null;
  const [failedUrl, setFailedUrl] = useState(null);
  const showImage = Boolean(url) && failedUrl !== url;

  return (
    <span
      className={`gd-avatar ${showImage ? 'gd-avatar--photo' : ''} ${className}`.trim()}
      style={{ '--gd-avatar-size': `${size}px` }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          className="gd-avatar__img"
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
