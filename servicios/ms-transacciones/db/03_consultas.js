// =============================================================================
//  03_consultas.js  ·  goldorado_transacciones  ·  mongosh
//
//  Consultas de sustentacion (el "03_consultas.sql" de Mongo).
//  Uso: mongosh "mongodb://localhost:27017" db/03_consultas.js
//  Requiere 01 + 02 (o `npm run db:setup`). Las secciones 9 a 11 ESCRIBEN
//  (documentos de demostracion GD-DEMO-*); el resto solo lee.
// =============================================================================

db = db.getSiblingDB('goldorado_transacciones');

const titulo = (texto) => print(`\n=== ${texto} ===`);
const hace15min = new Date(Date.now() - 15 * 60 * 1000);

// -----------------------------------------------------------------------------
titulo('1. Movimientos del usuario 1: find + proyeccion + orden + limite');
//    Lo mismo que hace ListarTransacciones. { idUsuario: 1 } encuentra los
//    NumberLong(1): Mongo compara numeros por valor, no por tipo.
printjson(
  db.transacciones
    .find({ idUsuario: 1 }, { _id: 0, codigo: 1, tipo: 1, estado: 1, monto: 1, creadoEn: 1 })
    .sort({ creadoEn: -1 })
    .limit(20)
    .toArray()
);

// -----------------------------------------------------------------------------
titulo('2. Trazabilidad del dinero de una apuesta (antes 9.4: Apuesta -> Transaccion -> Log_Transaccion)');
//    apuesta.id_transaccion (PostgreSQL) = transacciones.codigo (Mongo). El
//    historial viene en el MISMO documento: no hay JOIN.
printjson(db.transacciones.findOne({ codigo: 'b3a1c0de-0001-4a00-9000-000000000001' }, { _id: 0, codigo: 1, tipo: 1, estado: 1, monto: 1, historial: 1 }));

// -----------------------------------------------------------------------------
titulo('3. $unwind historial: la "tabla" Log_Transaccion de antes, una fila por cambio');
printjson(
  db.transacciones
    .aggregate([
      { $unwind: '$historial' },
      {
        $project: {
          _id: 0,
          codigo: 1,
          tipo: 1,
          estadoAnterior: '$historial.estadoAnterior',
          estadoNuevo: '$historial.estadoNuevo',
          ejecutadoPor: '$historial.ejecutadoPor',
          fecha: '$historial.fecha',
        },
      },
      { $sort: { codigo: 1, fecha: 1 } },
    ])
    .toArray()
);

// -----------------------------------------------------------------------------
titulo('4. Extracto por usuario: $group por tipo con sumas Decimal128');
printjson(
  db.transacciones
    .aggregate([
      { $match: { estado: 'COMPLETADO' } },
      { $group: { _id: { idUsuario: '$idUsuario', tipo: '$tipo' }, movimientos: { $sum: 1 }, total: { $sum: '$monto' } } },
      { $sort: { '_id.idUsuario': 1, '_id.tipo': 1 } },
    ])
    .toArray()
);

titulo('4b. Saldo con signo ($cond): entra DEPOSITO/PREMIO/REEMBOLSO, sale APUESTA/RETIRO');
//    Debe coincidir con cuenta_saldo.disponible de ms-apuestas: 250.000 y 84.500.
printjson(
  db.transacciones
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
          ultimoMovimiento: { $max: '$creadoEn' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()
);

// -----------------------------------------------------------------------------
titulo('5. Depositos por dia ($dateTrunc en hora de Bogota)');
printjson(
  db.transacciones
    .aggregate([
      { $match: { tipo: 'DEPOSITO', estado: 'COMPLETADO' } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$creadoEn', unit: 'day', timezone: 'America/Bogota' } },
          depositos: { $sum: 1 },
          total: { $sum: '$monto' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()
);

// -----------------------------------------------------------------------------
titulo('6. Auditoria de acceso (antes 9.3): intentos fallidos por correo, de siempre');
//    Los de idUsuario null usaron un correo que ni siquiera existe.
printjson(
  db.logs_sesion
    .aggregate([
      { $match: { exitoso: false } },
      {
        $group: {
          _id: '$emailIntento',
          intentosFallidos: { $sum: 1 },
          primero: { $min: '$fecha' },
          ultimo: { $max: '$fecha' },
          ips: { $addToSet: '$ip' },
        },
      },
      { $project: { _id: 0, correoIntentado: '$_id', intentosFallidos: 1, primero: 1, ultimo: 1, ipsDistintas: { $size: '$ips' } } },
      { $sort: { intentosFallidos: -1 } },
    ])
    .toArray()
);

// -----------------------------------------------------------------------------
titulo('7. Fuerza bruta EN CURSO: fallidos por correo en los ultimos 15 minutos');
//    Primero se simula un ataque (5 fallos desde 3 IPs contra demo@) para que
//    la ventana tenga datos; luego la agregacion que lo delata.
db.logs_sesion.insertMany(
  [1, 3, 5, 7, 9].map((minutos, i) => ({
    idUsuario: NumberLong(1),
    emailIntento: 'demo@goldorado.co',
    ip: ['45.132.90.7', '45.132.90.8', '103.21.244.9'][i % 3],
    userAgent: 'python-requests/2.32',
    exitoso: false,
    motivoFallo: 'Contraseña incorrecta',
    proveedor: 'LOCAL',
    fecha: new Date(Date.now() - minutos * 60 * 1000),
  }))
);
printjson(
  db.logs_sesion
    .aggregate([
      { $match: { exitoso: false, fecha: { $gte: hace15min } } },
      {
        $group: {
          _id: '$emailIntento',
          intentosFallidos: { $sum: 1 },
          ips: { $addToSet: '$ip' },
          cuentaExiste: { $max: { $ne: ['$idUsuario', null] } },
          ultimo: { $max: '$fecha' },
        },
      },
      { $project: { _id: 0, correoIntentado: '$_id', intentosFallidos: 1, ipsDistintas: { $size: '$ips' }, ips: 1, cuentaExiste: 1, ultimo: 1 } },
      { $sort: { intentosFallidos: -1 } },
    ])
    .toArray()
);
//    Lo que responde ContarIntentosFallidos para ese correo:
print('ContarIntentosFallidos(demo@goldorado.co, 15 min) =', db.logs_sesion.countDocuments({ emailIntento: 'demo@goldorado.co', exitoso: false, fecha: { $gte: hace15min } }));

// -----------------------------------------------------------------------------
titulo('8. $lookup eventos_seguridad -> transacciones por idUsuario');
//    Cada registro con lo que el usuario movio despues (referencia por id,
//    sin FK: las dos colecciones viven en la misma base pero sin JOIN fijo).
printjson(
  db.eventos_seguridad
    .aggregate([
      { $match: { tipo: 'REGISTRO' } },
      { $lookup: { from: 'transacciones', localField: 'idUsuario', foreignField: 'idUsuario', as: 'movimientos' } },
      {
        $project: {
          _id: 0,
          idUsuario: 1,
          correo: '$detalle.email',
          registradoEn: '$fecha',
          movimientos: { $size: '$movimientos' },
          primerMovimiento: { $min: '$movimientos.creadoEn' },
        },
      },
    ])
    .toArray()
);

// -----------------------------------------------------------------------------
titulo('9. Registro idempotente + cambio de estado con $push al historial');
//    Lo que hace RegistrarTransaccion: upsert con $setOnInsert. Correrlo dos
//    veces NO duplica (upsertedCount 0 la segunda vez).
const ahora = new Date();
printjson(
  db.transacciones.updateOne(
    { codigo: 'GD-DEMO-0001' },
    {
      $setOnInsert: {
        codigo: 'GD-DEMO-0001',
        idUsuario: NumberLong(2),
        tipo: 'DEPOSITO',
        estado: 'PENDIENTE',
        monto: NumberDecimal('20000.00'),
        moneda: 'COP',
        origen: 'sustentacion',
        proveedor: 'Wompi',
        metodo: 'PSE',
        creadoEn: ahora,
        actualizadoEn: ahora,
        historial: [{ estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: ahora, ejecutadoPor: 'SISTEMA' }],
      },
    },
    { upsert: true }
  )
);
//    Lo que hace ActualizarEstadoTransaccion: el filtro exige el estado
//    anterior (control optimista) y estado + historial cambian en UNA
//    operacion atomica. La segunda vez no encuentra nada que cambiar.
printjson(
  db.transacciones.updateOne(
    { codigo: 'GD-DEMO-0001', estado: 'PENDIENTE' },
    {
      $set: { estado: 'COMPLETADO', actualizadoEn: new Date() },
      $push: {
        historial: {
          estadoAnterior: 'PENDIENTE',
          estadoNuevo: 'COMPLETADO',
          fecha: new Date(),
          ejecutadoPor: 'WOMPI_WEBHOOK',
          payload: '{"ref":"GD-DEMO-0001","status":"APPROVED"}',
        },
      },
    }
  )
);
printjson(db.transacciones.findOne({ codigo: 'GD-DEMO-0001' }, { _id: 0, estado: 1, historial: 1 }));

// -----------------------------------------------------------------------------
titulo('10. El validador rechaza lo que rechazaban las CHECK (codigo 121)');
function intentar(descripcion, operacion) {
  try {
    operacion();
    print(`  ${descripcion}: ACEPTADO (no deberia)`);
  } catch (e) {
    print(`  ${descripcion}: rechazado, codigo ${e.code} ${e.codeName ?? ''}`);
  }
}
intentar('monto negativo (CHK_Transaccion_Monto)', () =>
  db.transacciones.insertOne({
    codigo: 'GD-DEMO-NEGATIVO',
    idUsuario: NumberLong(1),
    tipo: 'DEPOSITO',
    estado: 'COMPLETADO',
    monto: NumberDecimal('-5000.00'),
    moneda: 'COP',
    origen: 'sustentacion',
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha: new Date(), ejecutadoPor: 'SUSTENTACION' }],
  })
);
intentar('login fallido sin motivo (CHK_LogSesion_Motivo)', () =>
  db.logs_sesion.insertOne({
    idUsuario: null,
    emailIntento: 'alguien@goldorado.co',
    ip: '10.0.0.1',
    exitoso: false,
    proveedor: 'LOCAL',
    fecha: new Date(),
  })
);
intentar('tipo inexistente (CHK_Transaccion_Tipo)', () =>
  db.transacciones.updateOne({ codigo: 'GD-DEMO-0001' }, { $set: { tipo: 'REGALO' } })
);

titulo('11. Codigo repetido: el indice unico lo frena (codigo 11000)');
intentar('segundo GD-SEED-0001', () =>
  db.transacciones.insertOne({
    codigo: 'GD-SEED-0001',
    idUsuario: NumberLong(1),
    tipo: 'DEPOSITO',
    estado: 'COMPLETADO',
    monto: NumberDecimal('300000.00'),
    moneda: 'COP',
    origen: 'sustentacion',
    creadoEn: new Date(),
    actualizadoEn: new Date(),
    historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha: new Date(), ejecutadoPor: 'SUSTENTACION' }],
  })
);

// -----------------------------------------------------------------------------
titulo('12. explain("executionStats"): los indices hacen el trabajo');
function indicesUsados(nodo, encontrados = new Set()) {
  if (nodo && typeof nodo === 'object') {
    if (nodo.indexName) encontrados.add(nodo.indexName);
    Object.values(nodo).forEach((hijo) => indicesUsados(hijo, encontrados));
  }
  return [...encontrados];
}
function resumirPlan(nombre, plan) {
  const e = plan.executionStats;
  printjson({
    consulta: nombre,
    indices: indicesUsados(plan.queryPlanner.winningPlan),
    llavesExaminadas: e.totalKeysExamined,
    documentosExaminados: e.totalDocsExamined,
    devueltos: e.nReturned,
    milisegundos: e.executionTimeMillis,
  });
}
resumirPlan(
  'fuerza bruta (ContarIntentosFallidos)',
  db.logs_sesion.find({ emailIntento: 'demo@goldorado.co', exitoso: false, fecha: { $gte: hace15min } }).sort({ fecha: -1 }).explain('executionStats')
);
resumirPlan(
  'movimientos del usuario (ListarTransacciones)',
  db.transacciones.find({ idUsuario: 1 }).sort({ creadoEn: -1 }).limit(20).explain('executionStats')
);

// -----------------------------------------------------------------------------
titulo('13. TTL de logs_sesion: Mongo borra solo lo viejo');
db.logs_sesion
  .getIndexes()
  .filter((i) => i.expireAfterSeconds !== undefined)
  .forEach((i) => print(`  ${i.name}: expireAfterSeconds = ${i.expireAfterSeconds} (${i.expireAfterSeconds / 86400} dias)`));
const masViejo = db.logs_sesion.find({}, { _id: 0, emailIntento: 1, fecha: 1 }).sort({ fecha: 1 }).limit(1).toArray()[0];
if (masViejo) {
  const ttl = db.logs_sesion.getIndexes().find((i) => i.name === 'IX_LogsSesion_Fecha_TTL');
  const vence = new Date(masViejo.fecha.getTime() + ttl.expireAfterSeconds * 1000);
  print(`  Log mas viejo: ${masViejo.emailIntento} del ${masViejo.fecha.toISOString()}; el monitor TTL (cada ~60 s) lo borra despues del ${vence.toISOString()}`);
}
