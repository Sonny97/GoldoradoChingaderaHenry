/**
 * Promociones: el mapeo fila -> mensaje Promocion (sin duplicar filas por
 * torneo, DATE como 'YYYY-MM-DD' tal cual), las reglas de la destacada y los
 * mensajes de "no encontrada" del monolito.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CODIGOS } from '@goldorado/comun';
import { aPromocion } from '../src/repositorios/promocionRepo.js';
import { crearServicioPromociones } from '../src/servicios/promocionServicio.js';
import { crearHandlers } from '../src/grpc/handlers.js';
import { rechazaCon } from './falsos.js';

// Una fila como la entrega pg con el parser de DATE de config/db.js.
const FILA = {
  id_promocion: 1,
  titulo: '50% descuento',
  subtitulo: 'En tu primera recarga',
  descripcion: 'Duplicamos tu saldo hasta $200.000 en tu primer depósito de la semana. Aplica a todas las ligas.',
  badge: 'Nuevo',
  cta_label: 'Ver detalle',
  accent: 'gold',
  destacada: true,
  fecha_expira: '2027-01-08',
  ids_torneo: [1, 2, 3, 4],
};

describe('mapeo de promociones', () => {
  test('una fila por promocion con sus torneos en arreglo', () => {
    assert.deepEqual(aPromocion(FILA), {
      id: 1,
      titulo: '50% descuento',
      subtitulo: 'En tu primera recarga',
      descripcion: FILA.descripcion,
      badge: 'Nuevo',
      ctaLabel: 'Ver detalle',
      acento: 'gold',
      destacada: true,
      fechaExpira: '2027-01-08',
      idsTorneo: [1, 2, 3, 4],
    });
  });

  test('columnas NULL -> textos vacios y sin torneos -> arreglo vacio', () => {
    const p = aPromocion({ ...FILA, subtitulo: null, badge: null, accent: null, destacada: false, ids_torneo: [] });
    assert.equal(p.subtitulo, '');
    assert.equal(p.badge, '');
    assert.equal(p.acento, '');
    assert.equal(p.destacada, false);
    assert.deepEqual(p.idsTorneo, []);
  });

  test('la fecha sin hora no se corre de dia (no pasa por Date)', () => {
    assert.equal(aPromocion({ ...FILA, fecha_expira: '2026-12-31' }).fechaExpira, '2026-12-31');
  });
});

describe('servicio y handlers de promociones', () => {
  function armar({ vigentes = [aPromocion(FILA)], porId = null } = {}) {
    const llamadas = {};
    const repo = {
      async listarVigentes(opciones) {
        llamadas.listar = opciones;
        return vigentes;
      },
      async destacada() {
        return vigentes[0] ?? null;
      },
      async porId(id) {
        llamadas.porId = id;
        return porId;
      },
    };
    const promociones = crearServicioPromociones({ repo });
    const handlers = crearHandlers({ apuestas: {}, billetera: {}, promociones, salud: async () => ({}) });
    return { handlers, llamadas };
  }

  test('limite optional: ausente o 0 = sin limite; excluirDestacada llega como booleano', async () => {
    const { handlers, llamadas } = armar();
    await handlers.ListarPromociones({ limite: undefined, excluirDestacada: false });
    assert.deepEqual(llamadas.listar, { limite: null, excluirDestacada: false });
    await handlers.ListarPromociones({ limite: 3, excluirDestacada: true });
    assert.deepEqual(llamadas.listar, { limite: 3, excluirDestacada: true });
  });

  test('ListarPromociones responde mensajes Promocion', async () => {
    const { handlers } = armar();
    const r = await handlers.ListarPromociones({ excluirDestacada: false });
    assert.equal(r.promociones.length, 1);
    assert.equal(r.promociones[0].ctaLabel, 'Ver detalle');
    assert.deepEqual(r.promociones[0].idsTorneo, [1, 2, 3, 4]);
  });

  test('sin vigentes -> PromocionDestacada NOT_FOUND', async () => {
    const { handlers } = armar({ vigentes: [] });
    await rechazaCon(handlers.PromocionDestacada({}), CODIGOS.NOT_FOUND, 'No hay promociones disponibles');
  });

  test('ObtenerPromocion inexistente o id invalido -> NOT_FOUND', async () => {
    const { handlers, llamadas } = armar();
    await rechazaCon(handlers.ObtenerPromocion({ id: 99 }), CODIGOS.NOT_FOUND, 'Promoción no encontrada');
    assert.equal(llamadas.porId, 99);
    await rechazaCon(handlers.ObtenerPromocion({ id: 0 }), CODIGOS.NOT_FOUND, 'Promoción no encontrada');
  });
});
