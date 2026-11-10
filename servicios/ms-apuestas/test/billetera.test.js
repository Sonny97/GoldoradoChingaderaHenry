/**
 * Billetera: AsegurarBilletera, ObtenerBilletera y la IDEMPOTENCIA de
 * AcreditarDeposito (el webhook de Wompi y la conciliacion pueden llegar los
 * dos con el mismo pago). El repo falso imita al real: el UNIQUE de
 * movimiento_saldo.referencia decide si el movimiento entra.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { crearServicioBilletera } from '../src/servicios/billeteraServicio.js';
import { crearHandlers } from '../src/grpc/handlers.js';
import { logEnMemoria, rechazaCon } from './falsos.js';

function repoEnMemoria() {
  const billeteras = new Map();
  const movimientos = new Map(); // referencia -> movimiento (el UNIQUE)
  const copia = (id) => ({ ...billeteras.get(id) });
  const asegurar = async (id) => {
    if (!billeteras.has(id)) billeteras.set(id, { idUsuario: id, saldoDisponible: 0, saldoBloqueado: 0, moneda: 'COP' });
    return copia(id);
  };
  return {
    movimientos,
    asegurar,
    async obtener(id) {
      return billeteras.has(id) ? copia(id) : null;
    },
    async acreditarDeposito(datos) {
      await asegurar(datos.idUsuario);
      const previo = movimientos.get(datos.referencia);
      if (previo) {
        if (previo.idUsuario !== datos.idUsuario || previo.tipo !== 'DEPOSITO') return { conflicto: true };
        return { aplicado: false, billetera: copia(datos.idUsuario) };
      }
      movimientos.set(datos.referencia, { ...datos, tipo: 'DEPOSITO' });
      billeteras.get(datos.idUsuario).saldoDisponible += datos.monto;
      return { aplicado: true, billetera: copia(datos.idUsuario) };
    },
  };
}

function armar() {
  const repo = repoEnMemoria();
  const servicio = crearServicioBilletera({ repo, log: logEnMemoria() });
  const handlers = crearHandlers({ apuestas: {}, billetera: servicio, promociones: {}, salud: async () => ({}) });
  return { repo, servicio, handlers };
}

const deposito = (cambios = {}) => ({
  idUsuario: 1,
  monto: 50000,
  referencia: 'GD-20261109-0001',
  proveedor: 'Wompi',
  metodo: 'PSE',
  idTransaccionPasarela: '12345-1731160000-11111',
  ...cambios,
});

describe('AcreditarDeposito', () => {
  test('el mismo pago dos veces acredita UNA vez', async () => {
    const { handlers, repo } = armar();

    const primero = await handlers.AcreditarDeposito(deposito());
    assert.equal(primero.aplicado, true);
    assert.equal(primero.billetera.saldoDisponible, 50000);

    const reintento = await handlers.AcreditarDeposito(deposito());
    assert.equal(reintento.aplicado, false, 'el reintento se reconoce y se ignora');
    assert.equal(reintento.billetera.saldoDisponible, 50000, 'el saldo no cambia');
    assert.equal(repo.movimientos.size, 1);

    const otro = await handlers.AcreditarDeposito(deposito({ referencia: 'GD-20261109-0002', monto: 20000 }));
    assert.equal(otro.aplicado, true);
    assert.equal(otro.billetera.saldoDisponible, 70000);
  });

  test('crea la billetera si no existia (creacion perezosa) y responde COP', async () => {
    const { handlers } = armar();
    const r = await handlers.AcreditarDeposito(deposito({ idUsuario: 9 }));
    assert.deepEqual(r, {
      aplicado: true,
      billetera: { idUsuario: 9, saldoDisponible: 50000, saldoBloqueado: 0, moneda: 'COP' },
    });
  });

  test('la referencia de OTRO usuario no se acepta en silencio', async () => {
    const { handlers } = armar();
    await handlers.AcreditarDeposito(deposito());
    await rechazaCon(
      handlers.AcreditarDeposito(deposito({ idUsuario: 2 })),
      CODIGOS.ALREADY_EXISTS,
      'La referencia del pago ya se usó en otro movimiento'
    );
  });

  test('valida monto y referencia antes de tocar la base', async () => {
    const { handlers, repo } = armar();
    await rechazaCon(handlers.AcreditarDeposito(deposito({ monto: 0 })), CODIGOS.INVALID_ARGUMENT, 'Ingresa un monto válido');
    await rechazaCon(
      handlers.AcreditarDeposito(deposito({ monto: 100.5 })),
      CODIGOS.INVALID_ARGUMENT,
      'El monto debe ser un valor entero en pesos'
    );
    await rechazaCon(
      handlers.AcreditarDeposito(deposito({ referencia: '   ' })),
      CODIGOS.INVALID_ARGUMENT,
      'La referencia del pago es obligatoria'
    );
    await rechazaCon(handlers.AcreditarDeposito(deposito({ idUsuario: 0 })), CODIGOS.INVALID_ARGUMENT, 'Usuario no válido');
    assert.equal(repo.movimientos.size, 0);
  });

  test('proveedor/metodo vacios del contrato llegan al repo como null', async () => {
    const { servicio, repo } = armar();
    await servicio.acreditarDeposito(deposito({ proveedor: '', metodo: '', idTransaccionPasarela: '' }));
    const [mov] = repo.movimientos.values();
    assert.equal(mov.proveedor, null);
    assert.equal(mov.metodo, null);
    assert.equal(mov.idTransaccionPasarela, null);
  });
});

describe('AsegurarBilletera / ObtenerBilletera', () => {
  test('asegurar es idempotente y arranca en 0', async () => {
    const { handlers } = armar();
    const a = await handlers.AsegurarBilletera({ idUsuario: 4 });
    const b = await handlers.AsegurarBilletera({ idUsuario: 4 });
    assert.deepEqual(a, { idUsuario: 4, saldoDisponible: 0, saldoBloqueado: 0, moneda: 'COP' });
    assert.deepEqual(b, a);
  });

  test('obtener sin billetera -> NOT_FOUND con el mensaje del contrato', async () => {
    const { handlers } = armar();
    await rechazaCon(handlers.ObtenerBilletera({ idUsuario: 3 }), CODIGOS.NOT_FOUND, 'La cuenta no tiene billetera');
  });
});
