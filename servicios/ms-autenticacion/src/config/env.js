/**
 * Variables de entorno validadas UNA vez al arrancar (esquema en esquemaEnv.js).
 *
 * Si falta JWT_SECRET el proceso no arranca: un servicio de autenticacion sin
 * secreto firmaria tokens que cualquiera podria falsificar.
 */

import { cargarEnv } from '@goldorado/comun';
import { ESQUEMA } from './esquemaEnv.js';

export const env = cargarEnv(import.meta.url, ESQUEMA);
