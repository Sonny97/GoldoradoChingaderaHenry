/**
 * npm run db:setup -w @goldorado/ms-pagos
 *
 * Firestore no tiene "CREATE TABLE": las colecciones nacen con el primer
 * documento. Lo que si hay que preparar es:
 *   1. los datos semilla (02_datos.js), que corre este script;
 *   2. las reglas (todo cerrado) y los indices compuestos, que se despliegan con
 *      la CLI de Firebase porque el Admin SDK no puede crearlos.
 *
 * En modo memoria no hay nada que hacer: la semilla se carga al arrancar.
 */

import { env } from '../src/config/env.js';
import { sembrarPagos } from './02_datos.js';

const log = { info: (...p) => console.log(...p) };

function instruccionesCli(proyecto) {
  console.log(`
Reglas e indices (una vez por proyecto, desde servicios/ms-pagos):
  npm i -g firebase-tools        # si no tienes la CLI
  firebase login
  firebase deploy --only firestore:rules,firestore:indexes --project ${proyecto || '<FIREBASE_PROJECT_ID>'}

  (firebase.json apunta a db/firestore.rules y db/firestore.indexes.json)

Emulador local, sin cuenta de Google Cloud:
  firebase emulators:start --only firestore --project demo-goldorado
  y en el .env: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
`);
}

if (env.PAGOS_ALMACEN !== 'firestore') {
  console.log(
    'PAGOS_ALMACEN=memoria: no hay nada que preparar. El servicio arranca con GD-SEED-0001 y GD-SEED-0002 en memoria.\n' +
      'Para usar Firestore (el motor del tablero): PAGOS_ALMACEN=firestore + FIREBASE_CREDENCIALES (ver README.md).'
  );
  instruccionesCli(env.FIREBASE_PROJECT_ID);
  process.exit(0);
}

const { abrirFirestore } = await import('../src/config/firestore.js');
const conexion = abrirFirestore(env);
try {
  await conexion.comprobar();
  console.log(`Conectado a Firestore ${conexion.proyecto} (${conexion.origen}). Sembrando...`);
  const n = await sembrarPagos(conexion.db, log);
  console.log(`Listo: ${n} pagos semilla con su historial.`);
  instruccionesCli(conexion.proyecto);
} catch (error) {
  console.error(`No se pudo preparar Firestore: ${error?.message ?? error}`);
  console.error('Revisa FIREBASE_CREDENCIALES / FIREBASE_PROJECT_ID, o usa el emulador (FIRESTORE_EMULATOR_HOST).');
  process.exitCode = 1;
} finally {
  await conexion.cerrar();
}
