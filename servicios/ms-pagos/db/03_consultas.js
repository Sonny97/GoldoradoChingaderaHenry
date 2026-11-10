/**
 * Consultas de sustentacion de Firestore (el equivalente de 03_consultas.sql
 * del monolito), con el Admin SDK de firebase-admin 14.
 *
 * Firestore no tiene SQL: cada consulta es una cadena de where/orderBy/limit
 * que DEBE estar respaldada por un indice (db/firestore.indexes.json). Si
 * falta el indice, Firestore responde FAILED_PRECONDITION con un enlace para
 * crearlo. Las agregaciones count() y sum() se calculan en el servidor y se
 * cobran como una lectura por cada 1000 documentos, no por documento.
 *
 * Uso:  node db/03_consultas.js   (necesita PAGOS_ALMACEN=firestore y
 * credenciales, o FIRESTORE_EMULATOR_HOST con el emulador corriendo)
 */

import { pathToFileURL } from 'node:url';
import { AggregateField } from 'firebase-admin/firestore';

const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO', 'ANULADO', 'ERROR'];

/** @param {import('firebase-admin/firestore').Firestore} db */
export async function correrConsultas(db, salida = console) {
  const pagos = db.collection('pagos');
  const titulo = (t) => salida.log(`\n=== ${t}`);

  // 1. Historial de recargas de un usuario, la mas reciente primero.
  //    Indice: idUsuario ASC + creadoEn DESC.  (ListarPagos)
  titulo('1. Pagos del usuario 1, recientes primero');
  const delUsuario = await pagos.where('idUsuario', '==', 1).orderBy('creadoEn', 'desc').limit(10).get();
  delUsuario.forEach((d) => salida.log(`  ${d.id}  ${d.get('estado')}  $${d.get('monto')}  ${d.get('creadoEn').toDate().toISOString()}`));

  // 2. PENDIENTE con mas de N minutos: lo que revisa la conciliacion.
  //    Indice: estado ASC + creadoEn ASC.
  const minutos = 2;
  titulo(`2. PENDIENTE con mas de ${minutos} minutos (conciliacion)`);
  const corte = new Date(Date.now() - minutos * 60 * 1000);
  const viejos = await pagos.where('estado', '==', 'PENDIENTE').where('creadoEn', '<=', corte).orderBy('creadoEn', 'asc').limit(50).get();
  salida.log(`  ${viejos.size} pago(s)`);
  viejos.forEach((d) => salida.log(`  ${d.id}  creado ${d.get('creadoEn').toDate().toISOString()}`));

  // 3. APROBADO pero sin acreditar: dinero que Wompi cobro y que aun no esta en
  //    la billetera (ms-apuestas caido). Indice: estado ASC + acreditado ASC.
  titulo('3. APROBADO sin acreditar (deberia ser 0)');
  const sinAcreditar = await pagos.where('estado', '==', 'APROBADO').where('acreditado', '==', false).get();
  salida.log(`  ${sinAcreditar.size} pago(s)`);

  // 4. Cuantos pagos hay en cada estado: count() por estado (agregacion en el servidor).
  titulo('4. Cantidad de pagos por estado (count)');
  for (const estado of ESTADOS) {
    const r = await pagos.where('estado', '==', estado).count().get();
    salida.log(`  ${estado.padEnd(10)} ${r.data().count}`);
  }

  // 5. Total recaudado por estado: sum('monto') + count() en una sola agregacion.
  titulo('5. Total en pesos por estado (sum + count)');
  for (const estado of ESTADOS) {
    const r = await pagos
      .where('estado', '==', estado)
      .aggregate({ cantidad: AggregateField.count(), total: AggregateField.sum('monto') })
      .get();
    const { cantidad, total } = r.data();
    salida.log(`  ${estado.padEnd(10)} ${String(cantidad).padStart(3)} pago(s)  $${Number(total ?? 0).toLocaleString('es-CO')}`);
  }

  // 6. Ultimos eventos que llegaron por webhook, de TODOS los pagos:
  //    collectionGroup recorre todas las subcolecciones llamadas `eventos`.
  //    Indice de grupo de colecciones: origen ASC + fecha DESC.
  titulo('6. Ultimos eventos de webhook (collectionGroup eventos)');
  const webhooks = await db.collectionGroup('eventos').where('origen', '==', 'WEBHOOK').orderBy('fecha', 'desc').limit(10).get();
  webhooks.forEach((d) =>
    salida.log(`  ${d.ref.parent.parent.id}  ${d.get('tipo')}  ${d.get('estadoAnterior')} -> ${d.get('estadoNuevo')}`)
  );

  // 7. Historial completo de un pago (subcoleccion ordenada por fecha).
  titulo('7. Historial de GD-SEED-0002');
  const historial = await pagos.doc('GD-SEED-0002').collection('eventos').orderBy('fecha', 'asc').get();
  historial.forEach((d) => salida.log(`  ${d.get('fecha').toDate().toISOString()}  ${d.get('origen').padEnd(8)} ${d.get('tipo')}`));

  // 8. Pagos cuyo libro en MongoDB quedo pendiente (indice automatico de un campo).
  titulo('8. Libro de ms-transacciones pendiente');
  const libro = await pagos.where('libroPendiente', '==', true).get();
  salida.log(`  ${libro.size} pago(s)`);

  // 9. Pagos que tocan una transaccion de Wompi (array-contains): asi se
  //    resuelve el ?id= con el que vuelve el usuario del checkout.
  titulo('9. Pago de la transaccion Wompi 12-1762300000-10001 (array-contains)');
  const porId = await pagos.where('idsTransaccionWompi', 'array-contains', '12-1762300000-10001').limit(1).get();
  porId.forEach((d) => salida.log(`  ${d.id}`));

  // 10. runTransaction: lectura-modificacion-escritura atomica, el mismo patron
  //     de aplicarEstadoWompi. Si otro proceso cambia el documento entre la
  //     lectura y la escritura, Firestore reintenta la funcion con el dato nuevo.
  //     Aqui el pago ya esta acreditado, asi que la transaccion no escribe nada.
  titulo('10. runTransaction sobre GD-SEED-0001');
  const resultado = await db.runTransaction(async (t) => {
    const ref = pagos.doc('GD-SEED-0001');
    const snap = await t.get(ref);
    if (!snap.exists) return 'no existe (corre npm run db:setup)';
    if (snap.get('estado') === 'APROBADO' && snap.get('acreditado') === true) return 'ya acreditado: no se escribe nada';
    t.update(ref, { acreditado: true, acreditadoEn: new Date(), actualizadoEn: new Date() });
    return 'marcado como acreditado';
  });
  salida.log(`  ${resultado}`);

  // 11. Webhooks crudos deduplicados (id = sha256 del checksum).
  titulo('11. Ultimos webhooks crudos (eventos_wompi)');
  const crudos = await db.collection('eventos_wompi').orderBy('recibidoEn', 'desc').limit(5).get();
  salida.log(`  ${crudos.size} evento(s)`);
  crudos.forEach((d) => salida.log(`  ${d.id.slice(0, 12)}...  ${d.get('referencia')}  ${d.get('estadoWompi')}  procesado=${d.get('procesado')}`));
}

// --------------------------------------------------- ejecucion directa
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { env } = await import('../src/config/env.js');
  if (env.PAGOS_ALMACEN !== 'firestore') {
    console.log(
      'PAGOS_ALMACEN=memoria: estas consultas son de Firestore. Activa PAGOS_ALMACEN=firestore con ' +
        'FIREBASE_CREDENCIALES (o FIRESTORE_EMULATOR_HOST y "firebase emulators:start") y corre "npm run db:setup" primero.'
    );
    process.exit(0);
  }
  const { abrirFirestore } = await import('../src/config/firestore.js');
  const conexion = abrirFirestore(env);
  try {
    await conexion.comprobar();
    await correrConsultas(conexion.db);
  } catch (error) {
    console.error(`\nLa consulta fallo: ${error?.message ?? error}`);
    process.exitCode = 1;
  } finally {
    await conexion.cerrar();
  }
}
