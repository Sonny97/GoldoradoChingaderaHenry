// =============================================================================
//  npm run db:setup  ->  deja goldorado_transacciones lista para la demo.
//
//  Borra y crea las 3 colecciones con sus validadores e indices (los MISMOS
//  de src/esquema.js que usa el servicio), carga la semilla y verifica la
//  regla del taller: minimo 2 documentos por coleccion.
//
//  Usa el driver y no mongosh porque mongosh puede no estar instalado; los
//  scripts 01/02/03 de esta carpeta son la version legible para mongosh.
//  Sin transaccion multi-documento: un mongod suelto (docker, local) no las
//  soporta. No hace falta: el setup es repetible, si falla a medias se corre
//  otra vez y empieza de cero.
// =============================================================================

import { MongoClient } from 'mongodb';
import { crearLogger } from '@goldorado/comun';
import { env } from '../src/config/env.js';
import { uriSinCredenciales } from '../src/config/db.js';
import { COLECCIONES, recrearEsquema } from '../src/esquema.js';
import { documentosSemilla } from './semilla.js';

const log = crearLogger('ms-transacciones:db');
const cliente = new MongoClient(env.MONGO_URI, {
  appName: 'ms-transacciones-setup',
  serverSelectionTimeoutMS: 8000, // Atlas M0 puede tardar en despertar
});

try {
  const db = cliente.db(env.MONGO_DB);
  await db.command({ ping: 1 });
  log.info(`Recreando ${env.MONGO_DB} en ${uriSinCredenciales(env.MONGO_URI)}`);

  await recrearEsquema(db, { log, diasLogsSesion: env.LOGS_SESION_DIAS });

  const semilla = documentosSemilla();
  await db.collection(COLECCIONES.transacciones).insertMany(semilla.transacciones);
  await db.collection(COLECCIONES.logsSesion).insertMany(semilla.logsSesion);
  await db.collection(COLECCIONES.eventosSeguridad).insertMany(semilla.eventosSeguridad);

  // Verificacion (como el SELECT COUNT(*) al final de 02_datos.sql).
  let cumple = true;
  console.log('\nColeccion            Documentos  Minimo 2  Indices');
  for (const nombre of Object.values(COLECCIONES)) {
    const coleccion = db.collection(nombre);
    const total = await coleccion.countDocuments();
    const indices = (await coleccion.indexes()).map((i) => i.name).join(', ');
    if (total < 2) cumple = false;
    console.log(`${nombre.padEnd(20)} ${String(total).padStart(10)}  ${(total >= 2 ? 'OK' : 'FALTA').padEnd(8)}  ${indices}`);
  }

  // Cruce con ms-apuestas: el saldo con signo del libro debe dar el
  // disponible de cuenta_saldo (usuario 1 -> 250.000, usuario 2 -> 84.500).
  const saldos = await db
    .collection(COLECCIONES.transacciones)
    .aggregate([
      { $match: { estado: 'COMPLETADO' } },
      {
        $group: {
          _id: '$idUsuario',
          saldo: {
            $sum: {
              $cond: [{ $in: ['$tipo', ['DEPOSITO', 'PREMIO', 'REEMBOLSO']] }, '$monto', { $multiply: ['$monto', -1] }],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  console.log('\nSaldo segun el libro:', saldos.map((s) => `usuario ${s._id} = ${s.saldo.toString()}`).join(' | '));

  console.log(cumple ? '\nListo: todas las colecciones tienen al menos 2 documentos.' : '\nERROR: hay colecciones con menos de 2 documentos.');
  process.exitCode = cumple ? 0 : 1;
} catch (error) {
  log.error(`No se pudo preparar ${env.MONGO_DB}: ${error.message}`);
  log.error('¿Esta corriendo MongoDB? Local: mongod | docker compose up -d mongo | Atlas: revisa MONGO_URI y Network Access.');
  process.exitCode = 1;
} finally {
  await cliente.close();
}
