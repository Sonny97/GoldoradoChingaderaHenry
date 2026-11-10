/**
 * Reintento con espera exponencial para la API de Drive.
 *
 * gaxios ya reintenta GET/DELETE ante 429 y 5xx, pero NO reintenta POST
 * (files.create) ni PATCH, ni los 403 de cuota (userRateLimitExceeded /
 * rateLimitExceeded). La guia de Drive pide min(2^n s + azar, 32..64 s).
 * La espera se inyecta para que las pruebas no esperen de verdad.
 */

import { setTimeout as dormir } from 'node:timers/promises';

const RAZONES_DE_CUOTA = new Set(['userRateLimitExceeded', 'rateLimitExceeded']);

/** Estado HTTP de un error de gaxios/googleapis (o null si fue de red). */
export function estadoHttp(error) {
  const crudo = error?.status ?? error?.response?.status ?? error?.code;
  const n = Number(crudo);
  return Number.isInteger(n) && n >= 100 && n < 600 ? n : null;
}

/** 'storageQuotaExceeded', 'notFound', 'invalid_grant'... o '' si no viene. */
export function razonDrive(error) {
  const datos = error?.response?.data;
  return String(
    error?.errors?.[0]?.reason ??
      datos?.error?.errors?.[0]?.reason ??
      (typeof datos?.error === 'string' ? datos.error : '') ??
      ''
  );
}

export function esReintentable(error) {
  const estado = estadoHttp(error);
  if (estado === 429 || (estado !== null && estado >= 500)) return true;
  return estado === 403 && RAZONES_DE_CUOTA.has(razonDrive(error));
}

/**
 * @param {() => Promise<any>} fn  OJO: debe crear un stream NUEVO por intento
 * @param {{ max?: number, maxDemoraMs?: number, esperar?: (ms: number) => Promise<void> }} [o]
 */
export async function conReintentos(fn, { max = 5, maxDemoraMs = 32_000, esperar = dormir } = {}) {
  for (let intento = 0; ; intento += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!esReintentable(error) || intento >= max) throw error;
      await esperar(Math.min(2 ** intento * 1000 + Math.random() * 1000, maxDemoraMs));
    }
  }
}
