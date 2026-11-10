/**
 * Hidratacion de partidos: la razon de ser del BFF.
 *
 *   ms-deportes (MySQL)        el partido           PRINCIPAL (lo llama la ruta)
 *   ms-apuestas (PostgreSQL)   la franja de cuotas  secundario: caido -> odds: []
 *   ms-imagenes (Drive)        los escudos          secundario: caido -> crestUrl: null
 *
 * Para una lista de N partidos se hacen DOS llamadas secundarias en total (y en
 * paralelo), no 2N: CuotasPorEncuentros e BuscarImagenes reciben todos los ids
 * de una vez. Es el equivalente distribuido de evitar el N+1 en SQL.
 */

import { aMatch } from '../mapeadores/deportes.js';
import { opciones } from '../utils/contexto.js';
import { crearBuscadorImagenes } from './imagenes.js';

export function crearHidratadorEncuentros({ clientes, log }) {
  const imagenes = crearBuscadorImagenes({ clientes, log });

  function pedirCuotas(ids, req) {
    if (ids.length === 0) return Promise.resolve({ cuotas: [] });
    return clientes.apuestas.CuotasPorEncuentros({ idsEncuentro: ids }, opciones(req));
  }

  /** Map idEncuentro -> Cuota[] ordenadas por `orden`. */
  function agruparCuotas(resultado) {
    const porEncuentro = new Map();
    if (resultado.status !== 'fulfilled') {
      log.aviso(`CuotasPorEncuentros fallo (partidos sin cuotas): ${resultado.reason?.details ?? resultado.reason?.message}`);
      return porEncuentro;
    }
    for (const cuota of resultado.value?.cuotas ?? []) {
      const clave = Number(cuota.idEncuentro);
      if (!porEncuentro.has(clave)) porEncuentro.set(clave, []);
      porEncuentro.get(clave).push(cuota);
    }
    for (const lista of porEncuentro.values()) lista.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    return porEncuentro;
  }

  /** Encuentro[] del proto -> Match[] con cuotas y escudos. */
  async function hidratar(encuentros, req) {
    const lista = (encuentros ?? []).filter(Boolean);
    if (lista.length === 0) return [];

    const ids = [...new Set(lista.map((e) => Number(e.id)))];
    const equipos = lista.flatMap((e) => [e.local?.id, e.visitante?.id]);

    const [cuotas, escudos] = await Promise.allSettled([
      pedirCuotas(ids, req),
      imagenes.pedir('equipo', equipos, req),
    ]);
    const cuotasPorEncuentro = agruparCuotas(cuotas);
    const indiceEscudos = imagenes.aIndice(escudos, 'BuscarImagenes(equipo)');

    return lista.map((e) =>
      aMatch(e, { cuotas: cuotasPorEncuentro.get(Number(e.id)) ?? [], escudos: indiceEscudos })
    );
  }

  return { hidratar };
}
