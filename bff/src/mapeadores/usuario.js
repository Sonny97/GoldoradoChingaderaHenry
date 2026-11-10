/**
 * Usuario de ms-autenticacion (+ saldo de ms-apuestas + foto de ms-imagenes)
 * -> `User` de docs/API-REST.md.
 *
 * Campo por campo, a proposito: el objeto que entrega @grpc/proto-loader trae
 * propiedades virtuales (_tipoDocumento...) por cada `optional`, y un
 * {...usuario} las mandaria al navegador. Ademas aqui se decide que un dato
 * ausente es `null` y no `undefined`, que JSON.stringify borraria del objeto.
 */

/** Saldo de un usuario sin billetera todavia (cuenta recien creada). */
export const SALDO_CERO = Object.freeze({ balance: 0, lockedBalance: 0, currency: 'COP' });

/** Saldo cuando ms-apuestas no responde: el perfil sale igual, sin el numero. */
export const SALDO_DESCONOCIDO = Object.freeze({ balance: null, lockedBalance: null, currency: null });

export function aSaldo(billetera) {
  if (!billetera) return { ...SALDO_DESCONOCIDO };
  return {
    balance: Number(billetera.saldoDisponible ?? 0),
    lockedBalance: Number(billetera.saldoBloqueado ?? 0),
    currency: billetera.moneda || 'COP',
  };
}

export function aUser(usuario, { saldo = SALDO_DESCONOCIDO, avatarUrl = null } = {}) {
  return {
    id: Number(usuario.id),
    name: usuario.nombres ?? '',
    lastname: usuario.apellidos ?? '',
    fullName: usuario.nombreCompleto || `${usuario.nombres ?? ''} ${usuario.apellidos ?? ''}`.trim(),
    email: usuario.email,
    documentType: usuario.tipoDocumento ?? null,
    documentNumber: usuario.numeroDocumento ?? null,
    phone: usuario.telefono ?? null,
    birthDate: usuario.fechaNacimiento ?? null,
    balance: saldo.balance,
    lockedBalance: saldo.lockedBalance,
    currency: saldo.currency,
    role: String(usuario.rol ?? '').toLowerCase(),
    createdAt: usuario.creadoEn || null,
    profileComplete: Boolean(usuario.perfilCompleto),
    hasPassword: Boolean(usuario.tienePassword),
    providers: Array.isArray(usuario.proveedores) ? [...usuario.proveedores] : [],
    avatarUrl: avatarUrl ?? null,
  };
}

export const aProveedor = (p) => ({ code: p.codigo, name: p.nombre, enabled: Boolean(p.habilitado) });

export const aTipoDocumento = (t) => ({ value: t.codigo, label: t.nombre });
