/**
 * Armado del `User`: tres bases, una respuesta.
 *
 *   ms-autenticacion (SQL Server)  perfil          PRINCIPAL: si falla, la ruta falla
 *   ms-apuestas      (PostgreSQL)  saldo           secundario: sin billetera -> 0;
 *                                                  servicio caido -> null
 *   ms-imagenes      (Drive)       foto de perfil  secundario: caido -> null
 *
 * Los secundarios van con Promise.allSettled: uno caido no tumba el perfil.
 * Lo usan /me, login, register, completar-perfil, perfil, avatar y OAuth.
 */

import { CODIGOS } from '@goldorado/comun';

import { aSaldo, aUser, SALDO_CERO, SALDO_DESCONOCIDO } from '../mapeadores/usuario.js';
import { opciones } from '../utils/contexto.js';
import { crearBuscadorImagenes } from './imagenes.js';

export function crearArmadorUsuario({ clientes, log }) {
  const imagenes = crearBuscadorImagenes({ clientes, log });

  function saldoDe(resultado) {
    if (resultado.status === 'fulfilled') return aSaldo(resultado.value);
    // Usuario sin billetera todavia (registro reciente, o AsegurarBilletera
    // fallo en su momento): saldo cero, no "desconocido".
    if (resultado.reason?.code === CODIGOS.NOT_FOUND) return { ...SALDO_CERO };
    log.aviso(`ObtenerBilletera fallo (perfil sin saldo): ${resultado.reason?.details ?? resultado.reason?.message}`);
    return { ...SALDO_DESCONOCIDO };
  }

  const pedirSaldo = (idUsuario, req) => clientes.apuestas.ObtenerBilletera({ idUsuario }, opciones(req));

  /**
   * User a partir de un Usuario del proto ya obtenido.
   * @param billetera  Billetera ya conocida (p. ej. la que devolvio AsegurarBilletera)
   * @param avatarUrl  url ya conocida (recien subida) o null para "sin foto"
   */
  async function armar(usuario, req, { billetera, avatarUrl } = {}) {
    const id = Number(usuario.id);
    const [saldo, fotos] = await Promise.allSettled([
      billetera ? Promise.resolve(billetera) : pedirSaldo(id, req),
      avatarUrl !== undefined ? Promise.resolve(null) : imagenes.pedir('usuario', [id], req),
    ]);
    const avatar = avatarUrl !== undefined ? avatarUrl : imagenes.aIndice(fotos, 'BuscarImagenes(usuario)').get(String(id));
    return aUser(usuario, { saldo: saldoDe(saldo), avatarUrl: avatar ?? null });
  }

  /** User por id: las tres llamadas en paralelo. */
  async function porId(idUsuario, req, { avatarUrl } = {}) {
    const [usuario, saldo, fotos] = await Promise.allSettled([
      clientes.autenticacion.ObtenerUsuario({ idUsuario }, opciones(req)),
      pedirSaldo(idUsuario, req),
      avatarUrl !== undefined ? Promise.resolve(null) : imagenes.pedir('usuario', [idUsuario], req),
    ]);
    if (usuario.status === 'rejected') throw usuario.reason;
    const avatar =
      avatarUrl !== undefined ? avatarUrl : imagenes.aIndice(fotos, 'BuscarImagenes(usuario)').get(String(idUsuario));
    return aUser(usuario.value, { saldo: saldoDe(saldo), avatarUrl: avatar ?? null });
  }

  /**
   * Crea la billetera si no existe (registro, perfil completado, primer login
   * con Google/Microsoft). Mejor esfuerzo: si ms-apuestas esta caido el usuario
   * igual queda registrado, y la billetera se crea en el primer deposito.
   */
  async function asegurarBilletera(idUsuario, req) {
    try {
      return await clientes.apuestas.AsegurarBilletera({ idUsuario }, opciones(req));
    } catch (error) {
      log.aviso(`AsegurarBilletera(${idUsuario}) fallo: ${error?.details ?? error?.message}`);
      return null;
    }
  }

  return { armar, porId, asegurarBilletera };
}
