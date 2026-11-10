/**
 * Reglas de RegistrarApuesta con repo y ms-deportes FALSOS (sin base ni red).
 *
 * Lo que se cuida: los mismos mensajes del monolito, en el mismo orden, y que
 * lo que se puede rechazar sin tocar dinero se rechace antes de llegar a la
 * transaccion (ni siquiera se llama a ms-deportes por un monto mal escrito).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS, formatearCOP } from '@goldorado/comun';
import { crearServicioApuestas } from '../src/servicios/apuestaServicio.js';
import { crearHandlers } from '../src/grpc/handlers.js';
import { errorGrpc, logEnMemoria, rechazaCon } from './falsos.js';

const FECHA = '2026-11-09T15:00:00.000Z';

function contextoBase(cambios = {}) {
  return {
    idCuota: 1,
    valorCuota: 2,
    estadoCuota: 'ABIERTO',
    idEncuentro: 1,
    seleccion: 'Local',
    mercado: '1X2',
    idRegla: 1,
    montoMinimo: 5000,
    montoMaximo: 5000000,
    reglaNombre: 'Apuesta simple 1X2',
    ...cambios,
  };
}

/** Arma el servicio con dobles que registran cada llamada. */
function armar({ contexto = contextoBase(), estado = 'live', errorDeportes = null, saldo = 250000 } = {}) {
  const llamadas = { contexto: 0, deportes: [], registrar: [], carga: null };
  const repo = {
    async contextoDeCuota() {
      llamadas.contexto += 1;
      return contexto;
    },
    async registrarApuesta(datos) {
      llamadas.registrar.push(datos);
      if (saldo < datos.monto) return null; // el UPDATE condicionado afecto 0 filas
      llamadas.carga = datos.cargaEvento({ idApuesta: 77, fecha: FECHA });
      return {
        idApuesta: 77,
        idTransaccion: datos.idTransaccion,
        monto: datos.monto,
        cuota: datos.cuotaFijada,
        gananciaPotencial: datos.monto * datos.cuotaFijada,
        fecha: FECHA,
        saldoDisponible: saldo - datos.monto,
        saldoBloqueado: datos.monto,
      };
    },
    async listarApuestasDeUsuario(idUsuario, opciones) {
      llamadas.listar = { idUsuario, ...opciones };
      return [];
    },
    async resumenDeUsuario() {
      return llamadas.resumen;
    },
    async cuotasPorEncuentros(ids) {
      llamadas.cuotas = ids;
      return [];
    },
  };
  const deportes = {
    async obtenerEncuentro(id) {
      llamadas.deportes.push(id);
      if (errorDeportes) throw errorDeportes;
      return { id, estado };
    },
  };
  const log = logEnMemoria();
  const servicio = crearServicioApuestas({ repo, deportes, log, generarUuid: () => 'b3a1c0de-0009-4a00-9000-000000000009' });
  return { servicio, llamadas, log };
}

const apostar = (servicio, cambios = {}) => servicio.registrarApuesta({ idUsuario: 1, idCuota: 1, monto: 10000, ...cambios });

describe('RegistrarApuesta: validaciones en el orden del monolito', () => {
  test('monto invalido -> INVALID_ARGUMENT, sin consultar nada', async () => {
    for (const monto of [0, -5000, Number.NaN, 'abc', null]) {
      const { servicio, llamadas } = armar();
      await rechazaCon(apostar(servicio, { monto }), CODIGOS.INVALID_ARGUMENT, 'Ingresa un monto válido');
      assert.equal(llamadas.contexto, 0);
    }
  });

  test('monto con centavos -> mensaje de pesos enteros', async () => {
    const { servicio } = armar();
    await rechazaCon(apostar(servicio, { monto: 10000.5 }), CODIGOS.INVALID_ARGUMENT, 'El monto debe ser un valor entero en pesos');
  });

  test('sin cuota (0 = no enviada en proto3) -> pide seleccionarla', async () => {
    const { servicio } = armar();
    await rechazaCon(apostar(servicio, { idCuota: 0 }), CODIGOS.INVALID_ARGUMENT, 'Selecciona una cuota para apostar');
  });

  test('usuario 0 (error de integracion del BFF) -> INVALID_ARGUMENT', async () => {
    const { servicio, llamadas } = armar();
    await rechazaCon(apostar(servicio, { idUsuario: 0 }), CODIGOS.INVALID_ARGUMENT, 'Usuario no válido');
    assert.equal(llamadas.contexto, 0);
  });

  test('cuota inexistente -> NOT_FOUND sin preguntar a ms-deportes', async () => {
    const { servicio, llamadas } = armar({ contexto: null });
    await rechazaCon(apostar(servicio), CODIGOS.NOT_FOUND, 'La cuota seleccionada no existe');
    assert.equal(llamadas.deportes.length, 0);
  });

  test('partido terminado -> se dice ANTES que "cuota cerrada"', async () => {
    const { servicio, llamadas } = armar({ estado: 'finished', contexto: contextoBase({ estadoCuota: 'CERRADO' }) });
    await rechazaCon(apostar(servicio), CODIGOS.FAILED_PRECONDITION, 'Este partido ya terminó');
    assert.deepEqual(llamadas.deportes, [1]);
    assert.equal(llamadas.registrar.length, 0);
  });

  test('partido cancelado', async () => {
    const { servicio } = armar({ estado: 'canceled' });
    await rechazaCon(apostar(servicio), CODIGOS.FAILED_PRECONDITION, 'Este partido fue cancelado');
  });

  test('cuota cerrada o suspendida con el partido en juego', async () => {
    for (const estadoCuota of ['CERRADO', 'SUSPENDIDO']) {
      const { servicio } = armar({ contexto: contextoBase({ estadoCuota }) });
      await rechazaCon(apostar(servicio), CODIGOS.FAILED_PRECONDITION, 'Esta cuota está cerrada en este momento');
    }
  });

  test('mercado sin regla configurada', async () => {
    const { servicio } = armar({ contexto: contextoBase({ idRegla: null, montoMinimo: null, montoMaximo: null }) });
    await rechazaCon(apostar(servicio), CODIGOS.FAILED_PRECONDITION, 'Este mercado no tiene reglas de apuesta configuradas');
  });

  test('por debajo del minimo, con el monto en formato COP', async () => {
    const { servicio, llamadas } = armar();
    await rechazaCon(
      apostar(servicio, { monto: 4999 }),
      CODIGOS.FAILED_PRECONDITION,
      `El monto mínimo para este mercado es ${formatearCOP(5000)}`
    );
    assert.match(formatearCOP(5000), /5\.000/);
    assert.equal(llamadas.registrar.length, 0);
  });

  test('por encima del maximo', async () => {
    const { servicio } = armar({ contexto: contextoBase({ montoMaximo: 2000000 }) });
    await rechazaCon(
      apostar(servicio, { monto: 2000001 }),
      CODIGOS.FAILED_PRECONDITION,
      `El monto máximo para este mercado es ${formatearCOP(2000000)}`
    );
  });

  test('saldo insuficiente -> FAILED_PRECONDITION (lo decide el UPDATE del repo)', async () => {
    const { servicio, llamadas } = armar({ saldo: 3000 });
    await rechazaCon(apostar(servicio, { monto: 5000 }), CODIGOS.FAILED_PRECONDITION, 'Saldo insuficiente');
    assert.equal(llamadas.registrar.length, 1);
  });
});

describe('RegistrarApuesta: ms-deportes', () => {
  test('caido o lento -> UNAVAILABLE (falla cerrado) y un aviso en el log', async () => {
    for (const codigo of [CODIGOS.UNAVAILABLE, CODIGOS.DEADLINE_EXCEEDED, CODIGOS.INTERNAL]) {
      const { servicio, llamadas, log } = armar({ errorDeportes: errorGrpc(codigo) });
      await rechazaCon(
        apostar(servicio),
        CODIGOS.UNAVAILABLE,
        'No pudimos verificar el estado del partido. Intenta de nuevo.'
      );
      assert.equal(llamadas.registrar.length, 0, 'nunca se mueve dinero sin conocer el estado del partido');
      assert.equal(log.lineas.aviso.length, 1);
    }
  });

  test('el encuentro no existe en ms-deportes -> NOT_FOUND', async () => {
    const { servicio } = armar({ errorDeportes: errorGrpc(CODIGOS.NOT_FOUND) });
    await rechazaCon(apostar(servicio), CODIGOS.NOT_FOUND, 'Partido no encontrado');
  });
});

describe('RegistrarApuesta: camino feliz', () => {
  test('pasa al repo la regla y la cuota vigente, y arma el evento del libro', async () => {
    const { servicio, llamadas } = armar({ estado: 'upcoming' });
    const r = await apostar(servicio, { monto: '50000' });

    const [datos] = llamadas.registrar;
    assert.equal(datos.idUsuario, 1);
    assert.equal(datos.idCuota, 1);
    assert.equal(datos.idRegla, 1);
    assert.equal(datos.monto, 50000);
    assert.equal(datos.cuotaFijada, 2);
    assert.equal(datos.idTransaccion, 'b3a1c0de-0009-4a00-9000-000000000009');

    // RegistrarTransaccionRequest (transacciones.proto) en camelCase.
    assert.deepEqual(llamadas.carga, {
      codigo: 'b3a1c0de-0009-4a00-9000-000000000009',
      idUsuario: 1,
      tipo: 'APUESTA',
      estado: 'COMPLETADO',
      monto: 50000,
      moneda: 'COP',
      origen: 'ms-apuestas',
      referenciaExterna: 'apuesta:77',
      ejecutadoPor: 'APUESTA_WEB',
      fecha: FECHA,
    });

    assert.equal(r.idApuesta, 77);
    assert.equal(r.idEncuentro, 1);
    assert.equal(r.seleccion, 'Local');
    assert.equal(r.mercado, '1X2');
    assert.equal(r.saldoDisponible, 200000);
  });

  test('el handler responde ApuestaRegistrada completa', async () => {
    const { servicio } = armar();
    const handlers = crearHandlers({ apuestas: servicio, billetera: {}, promociones: {}, salud: async () => ({}) });
    const r = await handlers.RegistrarApuesta({ idUsuario: 1, idCuota: 1, monto: 10000 });
    assert.deepEqual(r, {
      idApuesta: 77,
      idTransaccion: 'b3a1c0de-0009-4a00-9000-000000000009',
      monto: 10000,
      cuota: 2,
      gananciaPotencial: 20000,
      fecha: FECHA,
      idEncuentro: 1,
      seleccion: 'Local',
      mercado: '1X2',
      saldoDisponible: 240000,
      saldoBloqueado: 10000,
    });
  });
});

describe('Historial, resumen y cuotas', () => {
  test('ListarApuestas: 20 por defecto (0 = no enviado), tope 100', async () => {
    const { servicio, llamadas } = armar();
    await servicio.historial(1, { limite: 0 });
    assert.equal(llamadas.listar.limite, 20);
    await servicio.historial(1, { limite: 5 });
    assert.equal(llamadas.listar.limite, 5);
    await servicio.historial(1, { limite: 5000 });
    assert.equal(llamadas.listar.limite, 100);
  });

  test('ResumenApuestas: rendimiento con la guarda de division por cero', async () => {
    const { servicio, llamadas } = armar();
    llamadas.resumen = { total: 0, ganadas: 0, perdidas: 0, pendientes: 0, apostado: 0, retornado: 0 };
    assert.equal((await servicio.resumen(1)).rendimiento, 0);

    llamadas.resumen = { total: 3, ganadas: 1, perdidas: 1, pendientes: 1, apostado: 100000, retornado: 150000 };
    assert.equal((await servicio.resumen(1)).rendimiento, 50);

    llamadas.resumen = { total: 2, ganadas: 0, perdidas: 2, pendientes: 0, apostado: 30000, retornado: 0 };
    assert.equal((await servicio.resumen(1)).rendimiento, -100);
  });

  test('CuotasPorEncuentros: vacio no va a la base; ids limpios y sin repetir', async () => {
    const { servicio, llamadas } = armar();
    assert.deepEqual(await servicio.cuotasPorEncuentros([]), []);
    assert.equal(llamadas.cuotas, undefined);
    await servicio.cuotasPorEncuentros([3, 1, 3, 0, -2]);
    assert.deepEqual(llamadas.cuotas, [3, 1]);
  });
});
