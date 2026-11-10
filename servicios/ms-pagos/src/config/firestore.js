/**
 * UNA conexion a Cloud Firestore para todo el proceso (Admin SDK modular de
 * firebase-admin 14).
 *
 * Credenciales, en este orden:
 *   1. FIRESTORE_EMULATOR_HOST  -> emulador local (no hace falta cuenta de servicio).
 *   2. FIREBASE_CREDENCIALES    -> ruta al JSON de la cuenta de servicio (relativa
 *      a la carpeta del servicio o absoluta) + FIREBASE_PROJECT_ID opcional.
 *   3. GOOGLE_APPLICATION_CREDENTIALS -> credenciales por defecto de Google.
 *
 * Si las credenciales faltan o el JSON no se puede leer, NO se lanza al
 * importar: el servicio igual arranca y Salud muestra el motivo (misma regla
 * que las bases SQL: un servicio que no arranca no sirve para diagnosticar).
 *
 * El Admin SDK se salta las reglas de seguridad (db/firestore.rules niegan
 * todo acceso de clientes): por eso esta llave vive solo en el backend.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { applicationDefault, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { raizDelPaquete } from '@goldorado/comun';

const NOMBRE_APP = 'ms-pagos';

/**
 * @param {Record<string, any>} env  el de src/config/env.js
 * @returns {{ db: import('firebase-admin/firestore').Firestore|null, proyecto: string,
 *             origen: string, error: Error|null, comprobar: () => Promise<void>, cerrar: () => Promise<void> }}
 */
export function abrirFirestore(env) {
  const raiz = raizDelPaquete(import.meta.url);
  const ruta = (valor) => (isAbsolute(valor) ? valor : resolve(raiz, valor));
  let app = null;
  let db = null;
  let error = null;
  let proyecto = env.FIREBASE_PROJECT_ID || '';
  let origen = '';

  try {
    if (env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_EMULATOR_HOST = env.FIRESTORE_EMULATOR_HOST;
      proyecto ||= 'demo-goldorado';
      origen = `emulador ${env.FIRESTORE_EMULATOR_HOST}`;
      app = initializeApp({ projectId: proyecto }, NOMBRE_APP);
    } else if (env.FIREBASE_CREDENCIALES) {
      const cuenta = JSON.parse(readFileSync(ruta(env.FIREBASE_CREDENCIALES), 'utf8'));
      proyecto ||= cuenta.project_id ?? '';
      origen = 'cuenta de servicio (FIREBASE_CREDENCIALES)';
      app = initializeApp({ credential: cert(cuenta), projectId: proyecto }, NOMBRE_APP);
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = ruta(env.GOOGLE_APPLICATION_CREDENTIALS);
      origen = 'GOOGLE_APPLICATION_CREDENTIALS';
      app = initializeApp({ credential: applicationDefault(), ...(proyecto ? { projectId: proyecto } : {}) }, NOMBRE_APP);
    } else {
      throw new Error(
        'Faltan credenciales de Firebase: define FIREBASE_CREDENCIALES (ruta al JSON de la cuenta de servicio), ' +
          'GOOGLE_APPLICATION_CREDENTIALS o FIRESTORE_EMULATOR_HOST, o usa PAGOS_ALMACEN=memoria.'
      );
    }
    db = getFirestore(app);
    // Un campo undefined (p. ej. un dato opcional de Wompi) no debe tumbar la escritura.
    db.settings({ ignoreUndefinedProperties: true });
  } catch (e) {
    error = e?.code === 'ENOENT' ? new Error(`No existe el archivo de credenciales de Firebase: ${e.path}`) : e;
  }

  return {
    db,
    proyecto: proyecto || '(predeterminado)',
    origen,
    error,
    async comprobar() {
      if (error) throw error;
      // Lectura minima: un documento como mucho.
      await db.collection('pagos').limit(1).get();
    },
    async cerrar() {
      if (app) await deleteApp(app);
    },
  };
}
