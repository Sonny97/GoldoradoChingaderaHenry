/**
 * Servicio de billetera. Mismo contrato { success, data, message }.
 *
 * El saldo vive en ms-apuestas (PostgreSQL) y el libro de movimientos en
 * ms-transacciones (MongoDB). El BFF los junta; aqui solo se piden.
 */

import { http } from './http';

/** { balance, lockedBalance, currency } */
export async function getWallet() {
  return http.get('/billetera', { auth: true });
}

/** Libro de movimientos: recargas, apuestas, premios. `type` filtra por tipo. */
export async function getMovements({ limit = 20, type } = {}) {
  return http.get('/billetera/movimientos', { query: { limite: limit, tipo: type }, auth: true });
}
