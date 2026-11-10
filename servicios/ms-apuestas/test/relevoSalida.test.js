/**
 * Relevo de la bandeja de salida con un repo en memoria y un ms-transacciones
 * falso: marca enviados, reintenta sin perder eventos, no se solapa y no
 * llena el log mientras el otro servicio esta caido.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { crearRelevoSalida } from '../src/servicios/relevoSalida.js';
import { errorGrpc, logEnMemoria } from './falsos.js';

/** evento_salida en memoria con las mismas primitivas que salidaRepo. */
function repoEnMemoria(cantidad = 3) {
  const eventos = Array.from({ length: cantidad }, (_, i) => ({
    id: i + 1,
    tipo: 'TRANSACCION',
    carga: { codigo: `uuid-${i + 1}`, idUsuario: 1, tipo: 'APUESTA', monto: 10000 },
    enviado: false,
    intentos: 0,
    ultimoError: null,
  }));
  return {
    eventos,
    caida: null,
    async enTransaccion(trabajo) {
      if (this.caida) throw this.caida;
      return trabajo({});
    },
    async tomarPendientes(_tx, limite) {
      return eventos.filter((e) => !e.enviado).slice(0, limite).map((e) => ({ ...e }));
    },
    async marcarEnviado(_tx, id) {
      const e = eventos.find((x) => x.id === id);
      e.enviado = true;
      e.intentos += 1;
      e.ultimoError = null;
    },
    async marcarFallido(_tx, id, mensaje) {
      const e = eventos.find((x) => x.id === id);
      e.intentos += 1;
      e.ultimoError = mensaje;
    },
  };
}

function transaccionesFalso() {
  return {
    recibidos: [],
    fallar: null, // (carga) => error | null
    async registrarTransaccion(carga) {
      const error = this.fallar?.(carga);
      if (error) throw error;
      this.recibidos.push(carga.codigo);
      return { codigo: carga.codigo };
    },
  };
}

describe('relevo de la bandeja de salida', () => {
  test('envia en orden y marca cada evento como enviado', async () => {
    const repo = repoEnMemoria(3);
    const transacciones = transaccionesFalso();
    const relevo = crearRelevoSalida({ repo, transacciones, log: logEnMemoria() });

    const resumen = await relevo.ejecutar();

    assert.deepEqual(resumen, { tomados: 3, enviados: 3, fallidos: 0 });
    assert.deepEqual(transacciones.recibidos, ['uuid-1', 'uuid-2', 'uuid-3']);
    assert.ok(repo.eventos.every((e) => e.enviado && e.intentos === 1));
  });

  test('respeta el tamano del lote', async () => {
    const repo = repoEnMemoria(5);
    const relevo = crearRelevoSalida({ repo, transacciones: transaccionesFalso(), log: logEnMemoria(), lote: 2 });
    assert.equal((await relevo.ejecutar()).enviados, 2);
    assert.equal(repo.eventos.filter((e) => e.enviado).length, 2);
  });

  test('ALREADY_EXISTS cuenta como enviado (RegistrarTransaccion es idempotente por codigo)', async () => {
    const repo = repoEnMemoria(1);
    const transacciones = transaccionesFalso();
    transacciones.fallar = () => errorGrpc(CODIGOS.ALREADY_EXISTS, 'ya existe');
    const relevo = crearRelevoSalida({ repo, transacciones, log: logEnMemoria() });
    await relevo.ejecutar();
    assert.equal(repo.eventos[0].enviado, true);
  });

  test('ms-transacciones caido: reintenta, corta el lote y avisa UNA sola vez', async () => {
    const repo = repoEnMemoria(3);
    const transacciones = transaccionesFalso();
    const log = logEnMemoria();
    const relevo = crearRelevoSalida({ repo, transacciones, log });

    transacciones.fallar = () => errorGrpc(CODIGOS.UNAVAILABLE, 'No connection established');
    await relevo.ejecutar();
    await relevo.ejecutar();
    await relevo.ejecutar();

    const [primero, segundo] = repo.eventos;
    assert.equal(primero.enviado, false, 'el evento no se pierde');
    assert.equal(primero.intentos, 3);
    assert.match(primero.ultimoError, /No connection established/);
    assert.equal(segundo.intentos, 0, 'el lote se corta al primer fallo de conexion');
    assert.equal(log.lineas.aviso.length, 1, 'un aviso, no uno por ciclo');

    transacciones.fallar = null;
    const resumen = await relevo.ejecutar();
    assert.equal(resumen.enviados, 3);
    assert.ok(repo.eventos.every((e) => e.enviado));
    assert.equal(primero.ultimoError, null);
    assert.ok(log.lineas.info.some((m) => m.includes('respondio de nuevo')));
  });

  test('un evento rechazado (dato invalido) no frena a los demas', async () => {
    const repo = repoEnMemoria(3);
    const transacciones = transaccionesFalso();
    transacciones.fallar = (carga) =>
      carga.codigo === 'uuid-1' ? errorGrpc(CODIGOS.INVALID_ARGUMENT, 'monto invalido') : null;
    const relevo = crearRelevoSalida({ repo, transacciones, log: logEnMemoria() });

    const resumen = await relevo.ejecutar();
    assert.deepEqual(resumen, { tomados: 3, enviados: 2, fallidos: 1 });
    assert.equal(repo.eventos[0].ultimoError, 'monto invalido');
    assert.deepEqual(transacciones.recibidos, ['uuid-2', 'uuid-3']);
  });

  test('nunca se solapa: dos llamadas simultaneas comparten el mismo ciclo', async () => {
    const repo = repoEnMemoria(2);
    let llamadas = 0;
    let liberar;
    const compuerta = new Promise((resolve) => {
      liberar = resolve;
    });
    const transacciones = {
      async registrarTransaccion() {
        llamadas += 1;
        await compuerta;
      },
    };
    const relevo = crearRelevoSalida({ repo, transacciones, log: logEnMemoria() });

    const a = relevo.ejecutar();
    const b = relevo.ejecutar();
    assert.equal(a, b, 'la segunda llamada recibe el ciclo en curso');
    liberar();
    await Promise.all([a, b]);
    assert.equal(llamadas, 2, 'cada evento se envio una sola vez');
  });

  test('PostgreSQL caido: un aviso, y el ciclo devuelve el error sin lanzar', async () => {
    const repo = repoEnMemoria(1);
    repo.caida = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
    const log = logEnMemoria();
    const relevo = crearRelevoSalida({ repo, transacciones: transaccionesFalso(), log });

    const r1 = await relevo.ejecutar();
    await relevo.ejecutar();
    assert.match(r1.error, /ECONNREFUSED/);
    assert.equal(log.lineas.aviso.length, 1);

    repo.caida = null;
    await relevo.ejecutar();
    assert.ok(log.lineas.info.some((m) => m.includes('PostgreSQL respondio de nuevo')));
    assert.equal(repo.eventos[0].enviado, true);
  });

  test('iniciar/detener: corre con el temporizador y se detiene limpio', async () => {
    const repo = repoEnMemoria(2);
    const transacciones = transaccionesFalso();
    const relevo = crearRelevoSalida({ repo, transacciones, log: logEnMemoria(), intervaloMs: 5 });

    relevo.iniciar();
    const limite = Date.now() + 2000;
    while (!repo.eventos.every((e) => e.enviado) && Date.now() < limite) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await relevo.detener();
    assert.ok(repo.eventos.every((e) => e.enviado));

    // Despues de detener no se toman eventos nuevos.
    repo.eventos.push({ id: 3, tipo: 'TRANSACCION', carga: { codigo: 'uuid-3' }, enviado: false, intentos: 0 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(repo.eventos[2].enviado, false);
  });
});
