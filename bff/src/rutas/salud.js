/**
 * GET /api/salud: el tablero de los seis microservicios.
 *
 * En el monolito era un SELECT 1 contra SQL Server. Aqui son seis llamadas
 * `Salud` en paralelo, cada una con plazo corto (2,5 s): un servicio colgado no
 * puede demorar la respuesta de los demas. El que no contesta aparece como
 * 'caido' con la pista del error, que es lo primero que hay que mirar cuando
 * "no carga nada".
 *
 * 200 solo si los seis estan 'ok'; si no, 503 (sirve para un balanceador).
 */

import { Router } from 'express';

import { PLAZOS } from '../clientes.js';
import { opciones } from '../utils/contexto.js';

const ORDEN = ['autenticacion', 'deportes', 'apuestas', 'transacciones', 'pagos', 'imagenes'];

function aEstado(salud) {
  return {
    servicio: salud.servicio,
    estado: salud.estado,
    motor: salud.motor,
    baseDatos: salud.baseDatos,
    modo: salud.modo,
    detalle: salud.detalle,
    version: salud.version,
    tiempoActivoSeg: Number(salud.tiempoActivoSeg ?? 0),
  };
}

function caido(cliente, error) {
  return {
    servicio: cliente.servicio,
    estado: 'caido',
    motor: null,
    baseDatos: null,
    modo: null,
    detalle: `Sin respuesta de ${cliente.direccion}: ${error?.details || error?.message || 'error desconocido'}`,
    version: null,
    tiempoActivoSeg: null,
  };
}

export function crearRutasSalud({ clientes }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const resultados = await Promise.allSettled(
      ORDEN.map((clave) => clientes[clave].Salud({}, opciones(req, { plazoMs: PLAZOS.salud })))
    );

    const servicios = resultados.map((r, i) =>
      r.status === 'fulfilled' ? aEstado(r.value) : caido(clientes[ORDEN[i]], r.reason)
    );
    const conProblemas = servicios.filter((s) => s.estado !== 'ok').map((s) => s.servicio);
    const todoBien = conProblemas.length === 0;

    res.status(todoBien ? 200 : 503).json({
      success: todoBien,
      data: { api: 'ok', servicios },
      message: todoBien ? '' : `Servicios con problemas: ${conProblemas.join(', ')}`,
    });
  });

  return router;
}
