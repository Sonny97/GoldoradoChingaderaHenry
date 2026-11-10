import { useState } from 'react';
import { shade, getContrastText } from '../../utils/color';

/**
 * Escudo de equipo generado, sin un solo archivo de imagen.
 *
 * Rectangulos grises de placeholder son el tell amateur mas fuerte en una UI
 * deportiva. En vez de eso: disco con el color REAL del equipo degradado
 * hacia su propia sombra, banda decorativa en el color secundario elegida por
 * crestSeed (3 patrones), y las iniciales encima. 3 patrones x 16 pares de
 * color hacen que cada escudo se distinga de un vistazo.
 *
 * EL COLOR DEL TEXTO SE CALCULA, no se hardcodea. Real Madrid, River y Junior
 * tienen colores claros: con blanco fijo sus iniciales serian invisibles.
 *
 * ESCUDO REAL OPCIONAL. Si ms-imagenes tiene el escudo en Drive, `crestUrl`
 * trae su ruta y se pinta como <img> DENTRO del mismo marco circular, encima
 * del disco generado. Si no hay URL, o la imagen falla al cargar (Drive caido,
 * archivo borrado), queda el escudo CSS de siempre: nunca un icono roto.
 */
export default function TeamCrest({ team, size = 56, winning = false, className = '' }) {
  // El hook va antes del return temprano: las reglas de hooks exigen el mismo
  // orden de llamadas en cada render, haya equipo o no.
  const [failedUrl, setFailedUrl] = useState(null);
  if (!team) return null;

  const crestUrl = team.crestUrl || null;
  const showImage = Boolean(crestUrl) && failedUrl !== crestUrl;

  const primary = team.colors?.primary ?? '#101b36';
  const secondary = team.colors?.secondary ?? '#f4f6fb';
  const band = (team.crestSeed ?? 0) % 3;

  return (
    <span
      className={`gd-crest gd-crest--band-${band} ${showImage ? 'gd-crest--photo' : ''} ${winning ? 'gd-crest--winning' : ''} ${className}`.trim()}
      style={{
        '--gd-crest-size': `${size}px`,
        '--gd-crest-c1': primary,
        '--gd-crest-c2': shade(primary, -0.42),
        '--gd-crest-band': secondary,
        '--gd-crest-fg': getContrastText(primary),
      }}
      title={team.name}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          className="gd-crest__img"
          src={crestUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(crestUrl)}
        />
      ) : (
        <span className="gd-crest__abbr">{team.short}</span>
      )}
    </span>
  );
}
