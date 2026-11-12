/**
 * Datos de ms-apuestas (proto) -> Odd, Promo, apuestas, resumen y billetera.
 *
 * `value` de una cuota es TEXTO con dos decimales ("2.00") porque asi lo pinta
 * el chip del frontend desde el monolito; `decimal` es el numero para calcular.
 */

const nulo = (v) => (v === undefined ? null : v);

export function aOdd(cuota) {
  const valor = Number(cuota.valor);
  return {
    key: cuota.codigoCorto,
    label: cuota.seleccion,
    value: valor.toFixed(2),
    decimal: valor,
    oddsId: Number(cuota.idCuota),
    market: cuota.mercado,
    open: cuota.estado === 'ABIERTO',
  };
}

/**
 * @param nombresTorneo Map idTorneo -> nombre (de ms-deportes). Si ms-deportes
 *                      no respondio llega vacio y `name` queda null.
 */
export function aPromo(promocion, { nombresTorneo = new Map(), imageUrl = null } = {}) {
  return {
    id: promocion.id,
    title: promocion.titulo,
    subtitle: promocion.subtitulo,
    description: promocion.descripcion,
    badge: promocion.badge,
    ctaLabel: promocion.ctaLabel,
    accent: promocion.acento,
    featured: Boolean(promocion.destacada),
    expiresAt: promocion.fechaExpira || null,
    leagues: (promocion.idsTorneo ?? []).map((id) => ({ id, name: nombresTorneo.get(id) ?? null })),
    imageUrl: imageUrl ?? null,
  };
}

export function aApuestaRegistrada(r) {
  return {
    betId: Number(r.idApuesta),
    transactionId: r.idTransaccion,
    amount: Number(r.monto),
    odds: Number(r.cuota),
    potentialWin: Number(r.gananciaPotencial),
    placedAt: r.fecha,
    matchId: Number(r.idEncuentro),
    selection: r.seleccion,
    market: r.mercado,
    balance: Number(r.saldoDisponible),
    lockedBalance: Number(r.saldoBloqueado),
  };
}

/** Partido resumido del historial; con nulls si ms-deportes no lo devolvio. */
export function aPartidoDeApuesta(idEncuentro, encuentro) {
  if (!encuentro) {
    return { id: Number(idEncuentro), status: null, kickoff: null, home: null, away: null, league: null };
  }
  return {
    id: Number(encuentro.id),
    status: encuentro.estado,
    kickoff: encuentro.fechaHora || null,
    home: encuentro.local?.nombre ?? null,
    away: encuentro.visitante?.nombre ?? null,
    league: encuentro.torneo?.nombre ?? null,
  };
}

export function aBet(apuesta, encuentro) {
  return {
    id: Number(apuesta.id),
    status: apuesta.estado,
    amount: Number(apuesta.monto),
    odds: Number(apuesta.cuota),
    potentialWin: Number(apuesta.gananciaPotencial),
    placedAt: apuesta.fecha,
    selection: apuesta.seleccion,
    market: apuesta.mercado,
    transactionId: nulo(apuesta.idTransaccion) || null,
    match: aPartidoDeApuesta(apuesta.idEncuentro, encuentro),
  };
}

export function aResumen(r) {
  return {
    total: r.total,
    won: r.ganadas,
    lost: r.perdidas,
    pending: r.pendientes,
    staked: Number(r.apostado),
    returned: Number(r.retornado),
    roi: r.rendimiento,
  };
}

export function aBilletera(b) {
  return {
    balance: Number(b.saldoDisponible ?? 0),
    lockedBalance: Number(b.saldoBloqueado ?? 0),
    currency: b.moneda || 'COP',
  };
}

/** RetiroResponse -> lo que recibe la pantalla de billetera tras un retiro. */
export function aRetiro(r) {
  return {
    reference: r.referencia,
    amount: Number(r.monto),
    balance: Number(r.billetera?.saldoDisponible ?? 0),
    lockedBalance: Number(r.billetera?.saldoBloqueado ?? 0),
    date: r.fecha || null,
  };
}

/** LiquidacionResponse -> Settlement (panel de administracion). */
export function aSettlement(r) {
  return {
    matchId: Number(r.idEncuentro),
    matchStatus: r.estadoPartido,
    settled: Number(r.liquidadas ?? 0),
    won: Number(r.ganadas ?? 0),
    lost: Number(r.perdidas ?? 0),
    voided: Number(r.anuladas ?? 0),
    paidOut: Number(r.totalPremios ?? 0),
  };
}
