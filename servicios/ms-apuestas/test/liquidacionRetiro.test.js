/**
 * LiquidarEncuentro y SolicitarRetiro con repos y ms-deportes FALSOS.
 *
 * - La tabla de decision (liquidacion.js) se prueba mercado por mercado,
 *   incluidos el empate y el 0-0.
 * - El repo en memoria imita al real: solo toca apuestas PENDIENTE, mueve el
 *   bloqueado/disponible y escribe movimiento + evento por cada pago.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS, constructorServicio } from '@goldorado/comun';

import { crearHandlers } from '../src/grpc/handlers.js';
import { crearServicioApuestas } from '../src/servicios/apuestaServicio.js';
import { crearServicioBilletera, validarRetiro } from '../src/servicios/billeteraServicio.js';
import { decidirApuesta } from '../src/servicios/liquidacion.js';
import { errorGrpc, logEnMemoria, rechazaCon } from './falsos.js';

const DEFINICION = constructorServicio('apuestas').service;

function idaYVuelta(metodo, respuesta) {
  const def = DEFINICION[metodo];
  return def.responseDeserialize(def.responseSerialize(respuesta));
}

// ------------------------------------------------------------ tabla de decision

describe('decidirApuesta: tabla por mercado', () => {
  const fin = (golesLocal, golesVisitante) => ({ estado: 'finished', golesLocal, golesVisitante });
  const casos = [
    // [mercado, codigo, local, visita, esperado]
    ['1X2', '1', 2, 1, 'GANADA'],
    ['1X2', '1', 1, 1, 'PERDIDA'],
    ['1X2', '1', 0, 2, 'PERDIDA'],
    ['1X2', 'X', 1, 1, 'GANADA'],
    ['1X2', 'X', 0, 0, 'GANADA'],
    ['1X2', 'X', 2, 1, 'PERDIDA'],
    ['1X2', '2', 0, 2, 'GANADA'],
    ['1X2', '2', 1, 1, 'PERDIDA'],
    ['1X2', '2', 3, 0, 'PERDIDA'],
    ['AMBOS_ANOTAN', 'GG', 1, 1, 'GANADA'],
    ['AMBOS_ANOTAN', 'GG', 2, 0, 'PERDIDA'],
    ['AMBOS_ANOTAN', 'GG', 0, 0, 'PERDIDA'],
    ['AMBOS_ANOTAN', 'NG', 2, 0, 'GANADA'],
    ['AMBOS_ANOTAN', 'NG', 0, 0, 'GANADA'],
    ['AMBOS_ANOTAN', 'NG', 1, 3, 'PERDIDA'],
    ['OVER_UNDER', 'O25', 2, 1, 'GANADA'],
    ['OVER_UNDER', 'O25', 1, 1, 'PERDIDA'],
    ['OVER_UNDER', 'O25', 0, 0, 'PERDIDA'],
    ['OVER_UNDER', 'U25', 1, 1, 'GANADA'],
    ['OVER_UNDER', 'U25', 0, 0, 'GANADA'],
    ['OVER_UNDER', 'U25', 3, 0, 'PERDIDA'],
  ];
  for (const [mercado, codigoCorto, l, v, esperado] of casos) {
    test(`${mercado} '${codigoCorto}' con ${l}-${v} -> ${esperado}`, () => {
      assert.equal(decidirApuesta({ mercado, codigoCorto }, fin(l, v)), esperado);
    });
  }

  test('partido cancelado -> ANULADA en cualquier mercado', () => {
    for (const [mercado, codigoCorto] of [
      ['1X2', '1'],
      ['AMBOS_ANOTAN', 'GG'],
      ['OVER_UNDER', 'U25'],
    ]) {
      assert.equal(decidirApuesta({ mercado, codigoCorto }, { estado: 'canceled' }), 'ANULADA');
    }
  });

  test('mercado desconocido -> null (la apuesta no se toca)', () => {
    assert.equal(decidirApuesta({ mercado: 'HANDICAP', codigoCorto: 'H1' }, fin(1, 0)), null);
  });
});

// ------------------------------------------------------------- LiquidarEncuentro

const CONTADOR = { GANADA: 'ganadas', PERDIDA: 'perdidas', ANULADA: 'anuladas' };

/** Repo en memoria con la misma semantica que apuestaRepo.liquidarEncuentro. */
function repoLiquidacion() {
  const billeteras = new Map([
    [1, { saldoDisponible: 100000, saldoBloqueado: 30000 }],
    [2, { saldoDisponible: 0, saldoBloqueado: 20000 }],
  ]);
  // Partido 7: una apuesta por mercado; la 5 es de otro partido y ya esta GANADA.
  const apuestas = [
    { id: 1, idUsuario: 1, idEncuentro: 7, mercado: '1X2', codigoCorto: '1', monto: 10000, ganancia: 25000, estado: 'PENDIENTE' },
    { id: 2, idUsuario: 1, idEncuentro: 7, mercado: 'AMBOS_ANOTAN', codigoCorto: 'GG', monto: 10000, ganancia: 18000, estado: 'PENDIENTE' },
    { id: 3, idUsuario: 1, idEncuentro: 7, mercado: 'OVER_UNDER', codigoCorto: 'U25', monto: 10000, ganancia: 19000, estado: 'PENDIENTE' },
    { id: 4, idUsuario: 2, idEncuentro: 7, mercado: '1X2', codigoCorto: 'X', monto: 20000, ganancia: 64000, estado: 'PENDIENTE' },
    { id: 5, idUsuario: 2, idEncuentro: 8, mercado: '1X2', codigoCorto: '1', monto: 5000, ganancia: 9000, estado: 'GANADA' },
  ];
  const cuotasCerradas = new Set();
  const movimientos = new Map();
  const eventos = [];
  return {
    billeteras,
    apuestas,
    movimientos,
    eventos,
    cuotasCerradas,
    async liquidarEncuentro({ idEncuentro, decidir, cargaEvento }) {
      cuotasCerradas.add(idEncuentro);
      const r = { liquidadas: 0, ganadas: 0, perdidas: 0, anuladas: 0, totalPremios: 0, sinDecidir: 0 };
      for (const a of apuestas.filter((x) => x.idEncuentro === idEncuentro && x.estado === 'PENDIENTE')) {
        const estado = decidir({ mercado: a.mercado, codigoCorto: a.codigoCorto });
        if (!estado) {
          r.sinDecidir += 1;
          continue;
        }
        const b = billeteras.get(a.idUsuario);
        const pago = estado === 'GANADA' ? a.ganancia : estado === 'ANULADA' ? a.monto : 0;
        const tipo = estado === 'GANADA' ? 'PREMIO' : estado === 'ANULADA' ? 'REEMBOLSO' : null;
        b.saldoBloqueado -= a.monto;
        b.saldoDisponible += pago;
        assert.ok(b.saldoBloqueado >= 0, 'CHECK saldo_bloqueado >= 0');
        if (tipo) {
          const codigo = `${tipo}-${a.id}`;
          assert.ok(!movimientos.has(codigo), 'UNIQUE referencia');
          movimientos.set(codigo, { tipo, monto: pago, idUsuario: a.idUsuario });
          eventos.push(
            cargaEvento({ tipo, codigo, idUsuario: a.idUsuario, monto: pago, idApuesta: a.id, fecha: '2026-11-11T00:00:00.000Z' })
          );
          r.totalPremios += pago;
        }
        a.estado = estado;
        r.liquidadas += 1;
        r[CONTADOR[estado]] += 1;
      }
      return r;
    },
  };
}

function armarLiquidacion(partido) {
  const repo = repoLiquidacion();
  const llamadas = [];
  const deportes = {
    async obtenerEncuentro(id) {
      llamadas.push(id);
      if (typeof partido === 'function') return partido(id);
      return { id, ...partido };
    },
  };
  const apuestas = crearServicioApuestas({ repo, deportes, log: logEnMemoria() });
  const handlers = crearHandlers({ apuestas, billetera: {}, promociones: {}, salud: async () => ({}) });
  return { repo, handlers, llamadas };
}

describe('LiquidarEncuentro', () => {
  test('finished 1-1: el empate gana y el resto segun su mercado; dinero y eventos', async () => {
    const { repo, handlers } = armarLiquidacion({ estado: 'finished', golesLocal: 1, golesVisitante: 1 });
    const r = idaYVuelta('LiquidarEncuentro', await handlers.LiquidarEncuentro({ idEncuentro: 7 }));

    // '1' pierde; GG, U25 y 'X' ganan
    assert.deepEqual(r, {
      idEncuentro: 7,
      estadoPartido: 'finished',
      liquidadas: 4,
      ganadas: 3,
      perdidas: 1,
      anuladas: 0,
      totalPremios: 18000 + 19000 + 64000,
    });
    assert.deepEqual(repo.billeteras.get(1), { saldoDisponible: 100000 + 18000 + 19000, saldoBloqueado: 0 });
    assert.deepEqual(repo.billeteras.get(2), { saldoDisponible: 64000, saldoBloqueado: 0 });
    assert.deepEqual([...repo.movimientos.keys()].sort(), ['PREMIO-2', 'PREMIO-3', 'PREMIO-4']);
    assert.ok(repo.cuotasCerradas.has(7));

    assert.deepEqual(
      repo.eventos.find((e) => e.codigo === 'PREMIO-4'),
      {
        codigo: 'PREMIO-4',
        idUsuario: 2,
        tipo: 'PREMIO',
        estado: 'COMPLETADO',
        monto: 64000,
        moneda: 'COP',
        origen: 'ms-apuestas',
        referenciaExterna: 'apuesta:4',
        ejecutadoPor: 'LIQUIDACION',
        fecha: '2026-11-11T00:00:00.000Z',
      }
    );
    // La apuesta de otro partido (ya GANADA) no se toca.
    assert.equal(repo.apuestas.find((a) => a.id === 5).estado, 'GANADA');
  });

  test('finished 0-0: X y U25 ganan; 1 y GG pierden', async () => {
    const { repo, handlers } = armarLiquidacion({ estado: 'finished', golesLocal: 0, golesVisitante: 0 });
    const r = await handlers.LiquidarEncuentro({ idEncuentro: 7 });
    assert.equal(r.ganadas, 2);
    assert.equal(r.perdidas, 2);
    assert.deepEqual(
      repo.apuestas.filter((a) => a.idEncuentro === 7).map((a) => a.estado),
      ['PERDIDA', 'PERDIDA', 'GANADA', 'GANADA']
    );
  });

  test('IDEMPOTENTE: la segunda llamada devuelve liquidadas 0 y no paga dos veces', async () => {
    const { repo, handlers } = armarLiquidacion({ estado: 'finished', golesLocal: 2, golesVisitante: 0 });
    const primera = await handlers.LiquidarEncuentro({ idEncuentro: 7 });
    assert.equal(primera.liquidadas, 4);
    const saldo = { ...repo.billeteras.get(1) };
    const eventos = repo.eventos.length;

    const segunda = await handlers.LiquidarEncuentro({ idEncuentro: 7 });
    assert.deepEqual(
      { liquidadas: segunda.liquidadas, ganadas: segunda.ganadas, totalPremios: segunda.totalPremios },
      { liquidadas: 0, ganadas: 0, totalPremios: 0 }
    );
    assert.deepEqual(repo.billeteras.get(1), saldo);
    assert.equal(repo.eventos.length, eventos);
  });

  test('partido cancelado: todo ANULADA y se devuelve el monto (REEMBOLSO)', async () => {
    const { repo, handlers } = armarLiquidacion({ estado: 'canceled' });
    const r = await handlers.LiquidarEncuentro({ idEncuentro: 7 });
    assert.equal(r.anuladas, 4);
    assert.equal(r.totalPremios, 50000);
    assert.deepEqual(repo.billeteras.get(1), { saldoDisponible: 130000, saldoBloqueado: 0 });
    assert.deepEqual(repo.billeteras.get(2), { saldoDisponible: 20000, saldoBloqueado: 0 });
    assert.equal(repo.movimientos.get('REEMBOLSO-4').tipo, 'REEMBOLSO');
    assert.equal(repo.eventos.find((e) => e.codigo === 'REEMBOLSO-1').tipo, 'REEMBOLSO');
  });

  test("live o upcoming -> FAILED_PRECONDITION 'El partido no ha terminado' sin tocar nada", async () => {
    for (const estado of ['live', 'upcoming']) {
      const { repo, handlers } = armarLiquidacion({ estado, golesLocal: 1, golesVisitante: 0 });
      await rechazaCon(
        handlers.LiquidarEncuentro({ idEncuentro: 7 }),
        CODIGOS.FAILED_PRECONDITION,
        'El partido no ha terminado'
      );
      assert.equal(repo.cuotasCerradas.size, 0);
    }
  });

  test('finished sin marcador -> FAILED_PRECONDITION', async () => {
    const { handlers } = armarLiquidacion({ estado: 'finished' });
    await rechazaCon(
      handlers.LiquidarEncuentro({ idEncuentro: 7 }),
      CODIGOS.FAILED_PRECONDITION,
      'El partido no tiene marcador final'
    );
  });

  test('ms-deportes: NOT_FOUND se respeta, otra falla es UNAVAILABLE; id 0 es INVALID_ARGUMENT', async () => {
    const noExiste = armarLiquidacion(() => {
      throw errorGrpc(CODIGOS.NOT_FOUND);
    });
    await rechazaCon(noExiste.handlers.LiquidarEncuentro({ idEncuentro: 99 }), CODIGOS.NOT_FOUND, 'Partido no encontrado');

    const caido = armarLiquidacion(() => {
      throw errorGrpc(CODIGOS.UNAVAILABLE);
    });
    await assert.rejects(caido.handlers.LiquidarEncuentro({ idEncuentro: 7 }), { codigo: CODIGOS.UNAVAILABLE });

    const { handlers, llamadas } = armarLiquidacion({ estado: 'finished', golesLocal: 0, golesVisitante: 0 });
    await rechazaCon(
      handlers.LiquidarEncuentro({ idEncuentro: 0 }),
      CODIGOS.INVALID_ARGUMENT,
      'Identificador de partido inválido'
    );
    assert.equal(llamadas.length, 0);
  });
});

// --------------------------------------------------------------- SolicitarRetiro

function repoRetiro(saldoInicial = 50000) {
  const b = { idUsuario: 1, saldoDisponible: saldoInicial, saldoBloqueado: 5000, moneda: 'COP' };
  const llamadas = [];
  const eventos = [];
  return {
    b,
    llamadas,
    eventos,
    async solicitarRetiro(datos) {
      llamadas.push(datos);
      if (b.saldoDisponible < datos.monto) return null;
      b.saldoDisponible -= datos.monto;
      const fecha = '2026-11-11T15:00:00.000Z';
      eventos.push(datos.cargaEvento({ fecha }));
      return { billetera: { ...b }, fecha };
    },
  };
}

function armarRetiro(saldo) {
  const repo = repoRetiro(saldo);
  const billetera = crearServicioBilletera({ repo, log: logEnMemoria(), ahora: () => new Date(1762873200000) });
  const handlers = crearHandlers({ apuestas: {}, billetera, promociones: {}, salud: async () => ({}) });
  return { repo, handlers };
}

const retiro = (cambios = {}) => ({
  idUsuario: 1,
  monto: 20000,
  banco: 'Bancolombia',
  tipoCuenta: 'AHORROS',
  numeroCuenta: '12345678901',
  ...cambios,
});

describe('SolicitarRetiro', () => {
  test('camino feliz: descuenta, referencia RET-<id>-<epochMs> y cuenta enmascarada', async () => {
    const { repo, handlers } = armarRetiro(50000);
    const r = idaYVuelta('SolicitarRetiro', await handlers.SolicitarRetiro(retiro()));
    assert.deepEqual(r, {
      referencia: 'RET-1-1762873200000',
      monto: 20000,
      billetera: { idUsuario: 1, saldoDisponible: 30000, saldoBloqueado: 5000, moneda: 'COP' },
      fecha: '2026-11-11T15:00:00.000Z',
    });

    const datos = repo.llamadas[0];
    assert.equal(datos.referencia, 'RET-1-1762873200000');
    assert.equal(datos.proveedor, 'Transferencia simulada');
    assert.equal(datos.metodo, 'AHORROS');
    assert.deepEqual(repo.eventos[0], {
      codigo: 'RET-1-1762873200000',
      idUsuario: 1,
      tipo: 'RETIRO',
      estado: 'COMPLETADO',
      monto: 20000,
      moneda: 'COP',
      origen: 'ms-apuestas',
      referenciaExterna: 'Bancolombia ****8901',
      proveedor: 'Transferencia simulada',
      metodo: 'AHORROS',
      ejecutadoPor: 'RETIRO_WEB',
      fecha: '2026-11-11T15:00:00.000Z',
    });
    // El numero completo no viaja al repositorio ni al libro contable.
    assert.ok(!JSON.stringify({ ...datos, eventos: repo.eventos }).includes('12345678901'));
  });

  test("saldo insuficiente -> FAILED_PRECONDITION 'Saldo insuficiente'", async () => {
    const { repo, handlers } = armarRetiro(15000);
    await rechazaCon(handlers.SolicitarRetiro(retiro()), CODIGOS.FAILED_PRECONDITION, 'Saldo insuficiente');
    assert.equal(repo.b.saldoDisponible, 15000);
    assert.equal(repo.eventos.length, 0);
  });

  test('validaciones -> INVALID_ARGUMENT sin llegar al repositorio', async () => {
    const { repo, handlers } = armarRetiro();
    const invalidos = [
      [{ monto: 9999 }, 'El monto mínimo de retiro es'],
      [{ monto: 15000.5 }, 'El monto debe ser un valor entero en pesos'],
      [{ monto: 0 }, 'Ingresa un monto válido'],
      [{ banco: '  ' }, 'Selecciona el banco de destino'],
      [{ tipoCuenta: 'NOMINA' }, 'El tipo de cuenta debe ser AHORROS o CORRIENTE'],
      [{ numeroCuenta: '12345' }, 'El número de cuenta debe tener entre 6 y 20 dígitos'],
      [{ numeroCuenta: '123456789012345678901' }, 'El número de cuenta debe tener entre 6 y 20 dígitos'],
      [{ numeroCuenta: '1234-5678' }, 'El número de cuenta debe tener entre 6 y 20 dígitos'],
      [{ idUsuario: 0 }, 'Usuario no válido'],
    ];
    for (const [cambios, mensaje] of invalidos) {
      await assert.rejects(handlers.SolicitarRetiro(retiro(cambios)), (error) => {
        assert.equal(error.codigo, CODIGOS.INVALID_ARGUMENT, JSON.stringify(cambios));
        assert.ok(error.message.startsWith(mensaje), `${error.message} / ${mensaje}`);
        return true;
      });
    }
    assert.equal(repo.llamadas.length, 0);
  });

  test('normaliza: tipo en minusculas, monto minimo exacto, cuentas de 6 y de 20 digitos', () => {
    assert.equal(validarRetiro(retiro({ tipoCuenta: 'corriente' })).tipoCuenta, 'CORRIENTE');
    assert.equal(validarRetiro(retiro({ monto: 10000 })).monto, 10000);
    assert.equal(validarRetiro(retiro({ numeroCuenta: '000123' })).cuentaEnmascarada, '****0123');
    assert.equal(validarRetiro(retiro({ numeroCuenta: '1'.repeat(20) })).cuentaEnmascarada, '****1111');
  });
});
