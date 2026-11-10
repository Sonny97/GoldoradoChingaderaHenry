/**
 * Datos semilla de Firestore (CONVENCIONES §5): los dos depositos que ya estan
 * acreditados en ms-apuestas (GD-SEED-0001 y GD-SEED-0002), cada uno con su
 * historial en la subcoleccion `eventos`.
 *
 * Es idempotente: los documentos tienen id fijo (la referencia y
 * 'semilla-01'...), asi que correrlo dos veces deja lo mismo. Los datos son
 * los de src/repositorios/semilla.js, los mismos que carga el modo memoria.
 *
 * Uso: node db/02_datos.js   (o npm run db:setup, que lo llama)
 */

import { pathToFileURL } from 'node:url';
import { pagosSemilla } from '../src/repositorios/semilla.js';

/** @param {import('firebase-admin/firestore').Firestore} db */
export async function sembrarPagos(db, log = console) {
  const lote = db.batch();
  const semillas = pagosSemilla(new Date());
  for (const { pago, eventos } of semillas) {
    const ref = db.collection('pagos').doc(pago.referencia);
    lote.set(ref, pago);
    eventos.forEach((evento, i) => {
      lote.set(ref.collection('eventos').doc(`semilla-${String(i + 1).padStart(2, '0')}`), evento);
    });
  }
  await lote.commit();

  // ---------------------------------------------------- consulta de verificacion
  const total = (await db.collection('pagos').count().get()).data().count;
  log.info(`pagos en Firestore: ${total}`);
  for (const { pago } of semillas) {
    const snap = await db.collection('pagos').doc(pago.referencia).get();
    const eventos = (await snap.ref.collection('eventos').count().get()).data().count;
    log.info(
      `  ${snap.id}  usuario ${snap.get('idUsuario')}  $${snap.get('monto')}  ${snap.get('metodo')}  ` +
        `${snap.get('estado')}  acreditado=${snap.get('acreditado')}  eventos=${eventos}`
    );
  }
  return semillas.length;
}

// --------------------------------------------------- ejecucion directa
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { env } = await import('../src/config/env.js');
  if (env.PAGOS_ALMACEN !== 'firestore') {
    console.log('PAGOS_ALMACEN=memoria: la semilla ya se carga sola al arrancar el servicio. Nada que hacer.');
    process.exit(0);
  }
  const { abrirFirestore } = await import('../src/config/firestore.js');
  const conexion = abrirFirestore(env);
  try {
    await conexion.comprobar();
    await sembrarPagos(conexion.db);
  } catch (error) {
    console.error(`No se pudo sembrar Firestore: ${error?.message ?? error}`);
    process.exitCode = 1;
  } finally {
    await conexion.cerrar();
  }
}
