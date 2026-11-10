import Base from './Icon';

/**
 * Set completo de iconos de GolDorado. Uso: <Icon.Lock size={20} />
 *
 * Las marcas sociales tambien van en TRAZO, no rellenas: un glifo de marca
 * relleno junto a iconos de trazo 1.75 en la misma fila del footer se ve como
 * dos footers pegados.
 */

export const User = (p) => (
  <Base {...p}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </Base>
);

export const Lock = (p) => (
  <Base {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Base>
);

export const Eye = (p) => (
  <Base {...p}>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const EyeOff = (p) => (
  <Base {...p}>
    <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.4 18.4 0 0 0 2 11s3.6 7 10 7a9 9 0 0 0 5.39-1.61" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </Base>
);

export const Mail = (p) => (
  <Base {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2.5 6.5 8.4 5.6a2 2 0 0 0 2.2 0l8.4-5.6" />
  </Base>
);

export const Phone = (p) => (
  <Base {...p}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
  </Base>
);

export const Calendar = (p) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="18" height="17" rx="2" />
    <line x1="3" y1="9.5" x2="21" y2="9.5" />
    <line x1="8" y1="2.5" x2="8" y2="6.5" />
    <line x1="16" y1="2.5" x2="16" y2="6.5" />
  </Base>
);

export const IdCard = (p) => (
  <Base {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2.5" />
    <circle cx="8.5" cy="11" r="2.5" />
    <path d="M4.6 17c.7-1.7 2.2-2.6 3.9-2.6s3.2.9 3.9 2.6" />
    <line x1="15" y1="9.5" x2="19.5" y2="9.5" />
    <line x1="15" y1="13" x2="19.5" y2="13" />
  </Base>
);

export const Football = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="m12 7.2 4.2 3.05-1.6 4.95H9.4L7.8 10.25 12 7.2Z" />
    <path d="M12 2.5v4.7M21.1 9.2l-4.9 1.05M17.6 20.6l-3-5.4M6.4 20.6l3-5.4M2.9 9.2l4.9 1.05" />
  </Base>
);

export const Trophy = (p) => (
  <Base {...p}>
    <path d="M7 3.5h10V10a5 5 0 0 1-10 0V3.5Z" />
    <path d="M7 5.5H4.2V7A3.5 3.5 0 0 0 7.7 10.5M17 5.5h2.8V7a3.5 3.5 0 0 1-3.5 3.5" />
    <path d="M12 15v3.2M8 21h8" />
    <path d="M9.4 21v-.4a2.6 2.6 0 0 1 5.2 0v.4" />
  </Base>
);

export const Shield = (p) => (
  <Base {...p}>
    <path d="M12 2.5 20 5.5v6c0 4.9-3.3 8.6-8 10-4.7-1.4-8-5.1-8-10v-6l8-3Z" />
  </Base>
);

export const Crest = (p) => (
  <Base {...p}>
    <path d="M12 2.5 20 5.5v6c0 4.9-3.3 8.6-8 10-4.7-1.4-8-5.1-8-10v-6l8-3Z" />
    <path d="m12 8 1.35 2.85 3.05.45-2.2 2.2.52 3.1L12 15.15 9.28 16.6l.52-3.1-2.2-2.2 3.05-.45L12 8Z" />
  </Base>
);

export const Gamepad = (p) => (
  <Base {...p}>
    <rect x="2" y="7" width="20" height="10.5" rx="4.5" />
    <line x1="7" y1="10.6" x2="7" y2="14" />
    <line x1="5.3" y1="12.3" x2="8.7" y2="12.3" />
    <circle cx="16.2" cy="11.2" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="18.6" cy="13.4" r="1.05" fill="currentColor" stroke="none" />
  </Base>
);

export const Wallet = (p) => (
  <Base {...p}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1.5" />
    <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
    <circle cx="16.5" cy="13.8" r="1.15" fill="currentColor" stroke="none" />
  </Base>
);

export const ChevronDown = (p) => (
  <Base {...p}>
    <polyline points="6 9.5 12 15.5 18 9.5" />
  </Base>
);

export const ChevronRight = (p) => (
  <Base {...p}>
    <polyline points="9.5 6 15.5 12 9.5 18" />
  </Base>
);

export const ArrowLeft = (p) => (
  <Base {...p}>
    <line x1="20" y1="12" x2="4" y2="12" />
    <polyline points="10 6 4 12 10 18" />
  </Base>
);

export const Close = (p) => (
  <Base {...p}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </Base>
);

export const Check = (p) => (
  <Base {...p}>
    <polyline points="4.5 12.5 9.5 17.5 19.5 6.5" />
  </Base>
);

export const CheckCircle = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <polyline points="7.8 12.2 10.8 15.2 16.2 8.8" />
  </Base>
);

export const Alert = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="12" y1="7.5" x2="12" y2="13" />
    <circle cx="12" cy="16.6" r=".95" fill="currentColor" stroke="none" />
  </Base>
);

export const Info = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <line x1="12" y1="16.5" x2="12" y2="11" />
    <circle cx="12" cy="7.6" r=".95" fill="currentColor" stroke="none" />
  </Base>
);

export const LogOut = (p) => (
  <Base {...p}>
    <path d="M9.5 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4.5" />
    <polyline points="16 16.5 21 12 16 7.5" />
    <line x1="21" y1="12" x2="9.5" y2="12" />
  </Base>
);

/* ------------------------------------------------------------- sociales */

export const Facebook = (p) => (
  <Base {...p}>
    <path d="M17.5 2.5h-2.8a4.7 4.7 0 0 0-4.7 4.7v2.8H7.2v3.9h2.8v7.6h3.9v-7.6h2.8l.8-3.9h-3.6V7.2a.8.8 0 0 1 .8-.8h2.8V2.5Z" />
  </Base>
);

export const Instagram = (p) => (
  <Base {...p}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.6" cy="6.4" r="1.05" fill="currentColor" stroke="none" />
  </Base>
);

export const XTwitter = (p) => (
  <Base {...p}>
    <path d="M3.2 3h4.4l4.55 6.05L17.4 3h3.3l-6.6 7.6L21.4 21H17l-4.9-6.5L6.3 21H3l7.05-8.1L3.2 3Z" />
  </Base>
);

export const YouTube = (p) => (
  <Base {...p}>
    <rect x="2" y="5" width="20" height="14" rx="4.5" />
    <path d="m10.2 8.8 5.6 3.2-5.6 3.2V8.8Z" />
  </Base>
);

/* ------------------------------------------------------------ iconos de flujo */

export const Camera = (p) => (
  <Base {...p}>
    <path d="M14.5 4h-5L7.5 6.5H4a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-3.5L14.5 4Z" />
    <circle cx="12" cy="13" r="3.5" />
  </Base>
);

export const Trash = (p) => (
  <Base {...p}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </Base>
);

export const Plus = (p) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const Bank = (p) => (
  <Base {...p}>
    <path d="M3 10 12 4l9 6" />
    <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
    <path d="M3 21h18" />
  </Base>
);

export const CreditCard = (p) => (
  <Base {...p}>
    <rect x="2" y="5" width="20" height="14" rx="2.5" />
    <path d="M2 10h20M6 15h4" />
  </Base>
);

export const Clock = (p) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const Ticket = (p) => (
  <Base {...p}>
    <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z" />
    <path d="M13 6v2M13 11v2M13 16v2" />
  </Base>
);

export const Devices = (p) => (
  <Base {...p}>
    <rect x="2" y="4" width="14" height="10" rx="1.5" />
    <path d="M6 18h6" />
    <rect x="17" y="8" width="5" height="12" rx="1.2" />
  </Base>
);

/* ------------------------------------------------------- marcas de terceros */

/*
 * EXCEPCION DELIBERADA a la regla del trazo. Google y Microsoft exigen en sus
 * guias de marca el logo relleno y con sus colores oficiales dentro del boton
 * "Continuar con...". Un "G" en trazo dorado no seria su marca, y el usuario
 * desconfia con razon de un boton de inicio de sesion que no la lleva. Por eso
 * estos dos no heredan currentColor.
 */

export const Google = ({ size = 20, title, className = '', ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={`gd-icon gd-icon--brand ${className}`.trim()}
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : 'true'}
    focusable="false"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A11.99 11.99 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.27a12 12 0 0 0 0 10.78l4.01-3.1Z" />
    <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 11.99 11.99 0 0 0 1.27 6.61l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
  </svg>
);

export const Microsoft = ({ size = 20, title, className = '', ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={`gd-icon gd-icon--brand ${className}`.trim()}
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : 'true'}
    focusable="false"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
    <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
    <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
    <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
  </svg>
);

const Icon = {
  User, Lock, Eye, EyeOff, Mail, Phone, Calendar, IdCard,
  Football, Trophy, Shield, Crest, Gamepad, Wallet,
  ChevronDown, ChevronRight, ArrowLeft, Close, Check, CheckCircle,
  Alert, Info, LogOut,
  Facebook, Instagram, XTwitter, YouTube,
  Camera, Trash, Plus, Bank, CreditCard, Clock, Ticket, Devices,
  Google, Microsoft,
};

export default Icon;
