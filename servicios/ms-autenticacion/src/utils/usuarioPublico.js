/**
 * Da forma al usuario que sale del servicio (mensaje Usuario del .proto).
 *
 * Port de aUsuarioPublico() del monolito. password_hash NUNCA sale de aqui:
 * terminaria en el BFF, en el contexto de React y en el localStorage. Solo
 * sale la consecuencia que le sirve a la interfaz: tienePassword.
 *
 * Los campos `optional` van en undefined cuando no hay dato, para que no viajen
 * (un '' le diria al frontend "documento vacio", que no es lo mismo que "no
 * tiene documento").
 */

import { aFechaIso, aFechaHoraIso } from '@goldorado/comun';

/**
 * Quien entro con Google o Microsoft todavia no tiene ficha de Cliente, pero el
 * proveedor si nos dijo su nombre: se parte en primera palabra / resto para
 * poder saludarlo ("Hola, Andrés") antes de que complete el perfil.
 */
function nombreDesdeProveedor(nombreProveedor) {
  const [nombres = '', ...resto] = String(nombreProveedor ?? '').trim().split(/\s+/);
  return { nombres, apellidos: resto.join(' ') };
}

export function aUsuarioPublico(fila) {
  if (!fila) return null;

  const perfilCompleto = Boolean(fila.tiene_cliente);
  const { nombres, apellidos } = perfilCompleto
    ? { nombres: fila.nombres ?? '', apellidos: fila.apellidos ?? '' }
    : nombreDesdeProveedor(fila.nombre_proveedor);

  return {
    id: Number(fila.id_usuario),
    email: fila.email,
    nombres,
    apellidos,
    nombreCompleto: `${nombres} ${apellidos}`.trim(),
    tipoDocumento: fila.tipo_documento ?? undefined,
    numeroDocumento: fila.numero_documento ?? undefined,
    telefono: fila.telefono ?? undefined,
    fechaNacimiento: aFechaIso(fila.fecha_nacimiento) ?? undefined,
    // En la base van en MAYUSCULA; en los contratos, en minuscula (CONVENCIONES §3).
    rol: String(fila.rol ?? 'CLIENTE').toLowerCase(),
    perfilCompleto,
    tienePassword: Boolean(fila.password_hash),
    proveedores: fila.proveedores ? String(fila.proveedores).split(',') : [],
    creadoEn: aFechaHoraIso(fila.fecha_creacion) ?? '',
    ultimoLogin: aFechaHoraIso(fila.ultimo_login) ?? undefined,
  };
}
