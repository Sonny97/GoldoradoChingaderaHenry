/**
 * Reglas de negocio de las apuestas y las cuotas.
 *
 * Port de server/servicios/apuestaServicio.js del monolito: mismos mensajes y
 * mismo orden. La diferencia es de donde sale cada dato: la cuota y la regla
 * vienen de PostgreSQL (repo), el estado del partido de ms-deportes (MySQL) por
 * gRPC. Si ms-deportes no responde, NO se acepta la apuesta (falla cerrado):
 * apostar a un partido que quiza ya termino es peor que pedir un reintento.
 *
 * Fabrica con dependencias inyectadas: las pruebas usan un repo y un
 * ms-deportes falsos.
 */

import { randomUUID } from 'node:crypto';
import { CODIGOS, formatearCOP, invalido, noDisponible, noEncontrado, precondicion } from '@goldorado/comun';
import { exigirIdUsuario, exigirMontoEntero } from '../utils/validacion.js';
import { decidirApuesta, ESTADOS_PARTIDO_LIQUIDABLES } from './liquidacion.js';

export const LIMITE_HISTORIAL = 20;
const LIMITE_HISTORIAL_MAXIMO = 100;

/**
 * @param {object} o
 * @param {object} o.repo      crearRepoApuestas()
 * @param {{ obtenerEncuentro: (id: number) => Promise<{ estado: string }> }} o.deportes
 * @param {object} [o.log]
 * @param {() => string} [o.generarUuid]
 */
export function crearServicioApuestas({ repo, deportes, log, generarUuid = randomUUID }) {
  /** Estado del partido segun ms-deportes. NOT_FOUND se respeta; cualquier otra falla es "no disponible". */
  async function estadoDelPartido(idEncuentro) {
    const encuentro = await leerPartido(idEncuentro);
    return encuentro?.estado ?? '';
  }

  /** El Encuentro completo de ms-deportes (estado y marcador), con los mismos errores. */
  async function leerPartido(idEncuentro) {
    try {
      return await deportes.obtenerEncuentro(idEncuentro);
    } catch (error) {
      if (error?.code === CODIGOS.NOT_FOUND) throw noEncontrado('Partido no encontrado');
      log?.aviso(`ms-deportes no respondio por el encuentro ${idEncuentro}: ${error?.details || error?.message}`);
      throw noDisponible('No pudimos verificar el estado del partido. Intenta de nuevo.');
    }
  }

  /**
   * Registra una apuesta.
   *
   * Orden deliberado: primero lo que se puede rechazar sin tocar dinero (monto
   * mal formado, partido cerrado, fuera de los limites de la regla) y de ultimo
   * la operacion con transaccion. Asi el caso frecuente (un error de
   * digitacion) ni siquiera abre una transaccion ni llama a ms-deportes.
   */
  async function registrarApuesta({ idUsuario, idCuota, monto: montoCrudo }) {
    const usuario = exigirIdUsuario(idUsuario);
    const monto = exigirMontoEntero(montoCrudo);

    if (!idCuota) throw invalido('Selecciona una cuota para apostar');

    const contexto = await repo.contextoDeCuota(idCuota);
    if (!contexto) throw noEncontrado('La cuota seleccionada no existe');

    const estadoEncuentro = await estadoDelPartido(contexto.idEncuentro);

    if (estadoEncuentro === 'finished') {
      throw precondicion('Este partido ya terminó');
    }

    if (estadoEncuentro === 'canceled') {
      throw precondicion('Este partido fue cancelado');
    }

    if (contexto.estadoCuota !== 'ABIERTO') {
      throw precondicion('Esta cuota está cerrada en este momento');
    }

    if (contexto.idRegla === null) {
      // No es culpa del usuario: falta configurar la regla del mercado.
      throw precondicion('Este mercado no tiene reglas de apuesta configuradas');
    }

    if (monto < contexto.montoMinimo) {
      throw precondicion(`El monto mínimo para este mercado es ${formatearCOP(contexto.montoMinimo)}`);
    }

    if (monto > contexto.montoMaximo) {
      throw precondicion(`El monto máximo para este mercado es ${formatearCOP(contexto.montoMaximo)}`);
    }

    // Un solo UUID une los tres registros de la apuesta: apuesta.id_transaccion,
    // movimiento_saldo.referencia y el `codigo` del documento en MongoDB.
    const idTransaccion = generarUuid();

    // El evento del libro contable (RegistrarTransaccionRequest de
    // transacciones.proto). Viaja por la bandeja de salida; `codigo` lo hace
    // idempotente en Mongo, asi que reenviarlo nunca duplica el movimiento.
    const cargaEvento = ({ idApuesta, fecha }) => ({
      codigo: idTransaccion,
      idUsuario: usuario,
      tipo: 'APUESTA',
      estado: 'COMPLETADO',
      monto,
      moneda: 'COP',
      origen: 'ms-apuestas',
      referenciaExterna: `apuesta:${idApuesta}`,
      ejecutadoPor: 'APUESTA_WEB',
      fecha,
    });

    // El saldo NO se comprueba aqui con un SELECT: la comprobacion va dentro
    // del UPDATE del repositorio, que es lo unico atomico. Ver apuestaRepo.
    const resultado = await repo.registrarApuesta({
      idUsuario: usuario,
      idCuota: contexto.idCuota,
      idRegla: contexto.idRegla,
      monto,
      cuotaFijada: contexto.valorCuota,
      idTransaccion,
      cargaEvento,
    });

    if (!resultado) throw precondicion('Saldo insuficiente');

    log?.info(
      `Apuesta ${resultado.idApuesta} registrada: usuario ${usuario}, ${formatearCOP(monto)} a ${contexto.seleccion} @ ${contexto.valorCuota}`
    );

    return {
      ...resultado,
      idEncuentro: contexto.idEncuentro,
      seleccion: contexto.seleccion,
      mercado: contexto.mercado,
    };
  }

  /** Historial: 20 por defecto (0 = no enviado en proto3), las mas recientes primero. */
  async function historial(idUsuario, { limite } = {}) {
    const usuario = exigirIdUsuario(idUsuario);
    const n = Number(limite);
    const tope = Number.isInteger(n) && n > 0 ? Math.min(n, LIMITE_HISTORIAL_MAXIMO) : LIMITE_HISTORIAL;
    return repo.listarApuestasDeUsuario(usuario, { limite: tope });
  }

  /** Panel "Tu semana". */
  async function resumen(idUsuario) {
    const datos = await repo.resumenDeUsuario(exigirIdUsuario(idUsuario));
    const apostado = datos.apostado ?? 0;
    const retornado = datos.retornado ?? 0;
    return {
      ...datos,
      apostado,
      retornado,
      // Rendimiento sobre lo apostado. Sin la guarda, un cliente sin apuestas
      // daria division por cero.
      rendimiento: apostado > 0 ? Math.round(((retornado - apostado) / apostado) * 100) : 0,
    };
  }

  /** Ids validos y sin repetir; lista vacia = respuesta vacia sin ir a la base. */
  async function cuotasPorEncuentros(idsEncuentro) {
    const ids = [...new Set((idsEncuentro ?? []).map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0);
    if (ids.length === 0) return [];
    return repo.cuotasPorEncuentros(ids);
  }

  /**
   * ADMIN. Liquida las apuestas PENDIENTE de un partido terminado o cancelado.
   *
   * ms-deportes es la fuente de verdad del resultado: se lee ANTES de abrir la
   * transaccion (nunca una llamada de red con filas bloqueadas). Lo que pasa con
   * cada apuesta lo decide decidirApuesta (tabla pura de liquidacion.js); el
   * dinero se mueve en el repositorio, en UNA transaccion. Como solo se tocan
   * apuestas PENDIENTE, una segunda llamada devuelve liquidadas 0 (idempotente).
   */
  async function liquidarEncuentro(idEncuentro) {
    const id = Number(idEncuentro);
    if (!Number.isSafeInteger(id) || id <= 0) throw invalido('Identificador de partido inválido');

    const partido = await leerPartido(id);
    const estadoPartido = partido?.estado ?? '';
    if (!ESTADOS_PARTIDO_LIQUIDABLES.includes(estadoPartido)) {
      throw precondicion('El partido no ha terminado');
    }
    const sinMarcador = (g) => g === null || g === undefined;
    if (estadoPartido === 'finished' && (sinMarcador(partido.golesLocal) || sinMarcador(partido.golesVisitante))) {
      throw precondicion('El partido no tiene marcador final');
    }

    // Evento del libro contable por cada pago (PREMIO o REEMBOLSO). `codigo`
    // = la referencia del movimiento ('PREMIO-<id_apuesta>'): idempotente en Mongo.
    const cargaEvento = ({ tipo, codigo, idUsuario, monto, idApuesta, fecha }) => ({
      codigo,
      idUsuario,
      tipo,
      estado: 'COMPLETADO',
      monto,
      moneda: 'COP',
      origen: 'ms-apuestas',
      referenciaExterna: `apuesta:${idApuesta}`,
      ejecutadoPor: 'LIQUIDACION',
      fecha,
    });

    const r = await repo.liquidarEncuentro({
      idEncuentro: id,
      decidir: (apuesta) => decidirApuesta(apuesta, partido),
      cargaEvento,
    });

    if (r.sinDecidir > 0) {
      log?.aviso(`Encuentro ${id}: ${r.sinDecidir} apuesta(s) de un mercado sin regla de liquidacion quedan PENDIENTE`);
    }
    log?.info(
      `Encuentro ${id} (${estadoPartido}) liquidado: ${r.liquidadas} apuestas, ${r.ganadas} ganadas, ${r.perdidas} perdidas, ${r.anuladas} anuladas, ${formatearCOP(r.totalPremios)} pagados`
    );

    return {
      idEncuentro: id,
      estadoPartido,
      liquidadas: r.liquidadas,
      ganadas: r.ganadas,
      perdidas: r.perdidas,
      anuladas: r.anuladas,
      totalPremios: r.totalPremios,
    };
  }

  return { registrarApuesta, historial, resumen, cuotasPorEncuentros, liquidarEncuentro };
}
