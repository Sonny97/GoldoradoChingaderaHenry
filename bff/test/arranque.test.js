/**
 * Arranque real del BFF como proceso, SIN ningun microservicio.
 *
 * Es la regla del monolito llevada a microservicios: el API arranca aunque lo
 * de atras este caido, y /api/salud dice exactamente que falta. Las seis
 * direcciones apuntan a puertos libres (nadie escucha), asi que los seis deben
 * aparecer como 'caido' y la respuesta debe ser 503.
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { esperarPuerto, lanzarProceso, puertoLibre } from '@goldorado/comun/pruebas';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

test('el BFF arranca sin servicios y /api/salud responde 503 con los 6 caidos', async () => {
  const puerto = await puertoLibre();
  const nadie = [];
  for (let i = 0; i < 6; i += 1) nadie.push(`127.0.0.1:${await puertoLibre()}`);

  const proceso = lanzarProceso({
    cwd: RAIZ,
    env: {
      PORT: String(puerto),
      COOKIE_SECRETO: 'prueba-arranque',
      GRPC_TOKEN_INTERNO: '',
      MS_AUTENTICACION_URL: nadie[0],
      MS_DEPORTES_URL: nadie[1],
      MS_APUESTAS_URL: nadie[2],
      MS_TRANSACCIONES_URL: nadie[3],
      MS_PAGOS_URL: nadie[4],
      MS_IMAGENES_URL: nadie[5],
    },
  });

  try {
    await esperarPuerto(puerto, { plazoMs: 15000 });
    const res = await fetch(`http://127.0.0.1:${puerto}/api/salud`);
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.data.api, 'ok');
    assert.equal(json.data.servicios.length, 6);
    assert.ok(json.data.servicios.every((s) => s.estado === 'caido' && s.detalle), JSON.stringify(json.data.servicios));

    const ruta = await fetch(`http://127.0.0.1:${puerto}/api/encuentros`);
    assert.equal(ruta.status, 503);
    assert.equal((await ruta.json()).message, 'El servicio ms-deportes no está disponible en este momento');
  } catch (error) {
    error.message += `\n--- salida del BFF ---\n${proceso.salida()}`;
    throw error;
  } finally {
    await proceso.detener();
  }
});
