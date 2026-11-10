// =============================================================================
//  01_colecciones.js  ·  goldorado_transacciones  ·  mongosh
//
//  El "01_esquema.sql" de la parte transaccional y de seguridad: crea las 3
//  colecciones con su validador $jsonSchema (lo que eran las CHECK) y sus
//  indices con nombre (los IX_ de antes).
//
//  Uso:   mongosh "mongodb://localhost:27017" db/01_colecciones.js
//  OJO:   BORRA las 3 colecciones. El servicio, al arrancar, solo crea lo que
//         falte; `npm run db:setup` hace 01 + 02 con el driver (sin mongosh).
//  Copia legible de src/esquema.js: si cambias algo aqui, cambialo alla
//  (test/esquema.test.js vigila que los nombres coincidan).
// =============================================================================

// Equivale a `use goldorado_transacciones` (los helpers como `use` no valen en un .js).
db = db.getSiblingDB('goldorado_transacciones');

const TIPOS = ['DEPOSITO', 'RETIRO', 'APUESTA', 'PREMIO', 'REEMBOLSO'];
const ESTADOS = ['PENDIENTE', 'COMPLETADO', 'FALLIDO', 'REVERSADO'];
const DIAS_LOGS_SESION = 180; // LOGS_SESION_DIAS del .env

db.transacciones.drop();
db.logs_sesion.drop();
db.eventos_seguridad.drop();

// -----------------------------------------------------------------------------
// transacciones = Transaccion + Log_Transaccion. El log va EMBEBIDO en
// `historial`: siempre se lee junto con la transaccion, crece poco y el
// cambio de estado + su rastro se escriben en UNA operacion atomica.
// -----------------------------------------------------------------------------
db.createCollection('transacciones', {
  validationLevel: 'strict', // valida inserciones Y actualizaciones
  validationAction: 'error', // rechaza (codigo 121), no solo advierte
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'transacciones',
      required: ['codigo', 'idUsuario', 'tipo', 'estado', 'monto', 'moneda', 'origen', 'creadoEn', 'actualizadoEn', 'historial'],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'objectId' },
        codigo: { bsonType: 'string', minLength: 1, maxLength: 150, description: 'clave de negocio unica: UUID de la apuesta o referencia del pago' },
        idUsuario: { bsonType: 'long', minimum: 1, description: 'Usuario.id_usuario (SQL Server)' },
        tipo: { enum: TIPOS, description: 'CHK_Transaccion_Tipo' },
        estado: { enum: ESTADOS, description: 'CHK_Transaccion_Estado' },
        // CHK_Transaccion_Monto: el signo lo da el tipo; 0 o negativo no existe.
        monto: { bsonType: 'decimal', minimum: 0, exclusiveMinimum: true, description: 'CHK_Transaccion_Monto' },
        moneda: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
        origen: { bsonType: 'string', minLength: 1, maxLength: 50 },
        referenciaExterna: { bsonType: 'string', minLength: 1, maxLength: 150 },
        proveedor: { bsonType: 'string', minLength: 1, maxLength: 50 },
        metodo: { bsonType: 'string', minLength: 1, maxLength: 50 },
        creadoEn: { bsonType: 'date' },
        actualizadoEn: { bsonType: 'date' },
        historial: {
          bsonType: 'array',
          minItems: 1,
          items: {
            bsonType: 'object',
            required: ['estadoAnterior', 'estadoNuevo', 'fecha', 'ejecutadoPor'],
            additionalProperties: false,
            properties: {
              estadoAnterior: { enum: [null, ...ESTADOS] }, // null = acaba de nacer
              estadoNuevo: { enum: ESTADOS },
              fecha: { bsonType: 'date' },
              ejecutadoPor: { bsonType: 'string', minLength: 1, maxLength: 50 },
              codigoError: { bsonType: 'string', minLength: 1, maxLength: 50 },
              payload: { bsonType: 'string' },
            },
          },
        },
      },
    },
  },
});
db.transacciones.createIndex({ codigo: 1 }, { name: 'UQ_Transacciones_Codigo', unique: true });
db.transacciones.createIndex({ idUsuario: 1, creadoEn: -1 }, { name: 'IX_Transacciones_Usuario_Fecha' });
db.transacciones.createIndex({ tipo: 1, estado: 1, creadoEn: -1 }, { name: 'IX_Transacciones_Tipo_Estado_Fecha' });

// -----------------------------------------------------------------------------
// logs_sesion = Log_Sesion. idUsuario es null A PROPOSITO cuando el correo
// tecleado no existe: esa traza es la que delata la fuerza bruta.
// -----------------------------------------------------------------------------
db.createCollection('logs_sesion', {
  validationLevel: 'strict',
  validationAction: 'error',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'logs_sesion',
      required: ['idUsuario', 'emailIntento', 'ip', 'exitoso', 'proveedor', 'fecha'],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'objectId' },
        idUsuario: { bsonType: ['long', 'null'], minimum: 1 },
        emailIntento: { bsonType: 'string', minLength: 1, maxLength: 150 },
        ip: { bsonType: 'string', minLength: 1, maxLength: 45 }, // 45 = IPv6
        userAgent: { bsonType: 'string', minLength: 1, maxLength: 255 },
        exitoso: { bsonType: 'bool' },
        motivoFallo: { bsonType: 'string', minLength: 1, maxLength: 100 },
        proveedor: { enum: ['LOCAL', 'GOOGLE', 'MICROSOFT'] },
        fecha: { bsonType: 'date' },
      },
      // CHK_LogSesion_Motivo: exitoso = 1 OR motivo_fallo IS NOT NULL.
      anyOf: [{ properties: { exitoso: { enum: [true] } } }, { required: ['motivoFallo'] }],
    },
  },
});
db.logs_sesion.createIndex({ emailIntento: 1, fecha: -1 }, { name: 'IX_LogsSesion_Email_Fecha' });
db.logs_sesion.createIndex({ idUsuario: 1, fecha: -1 }, { name: 'IX_LogsSesion_Usuario_Fecha' });
// TTL: Mongo borra solo los logs con mas de DIAS_LOGS_SESION dias.
db.logs_sesion.createIndex({ fecha: 1 }, { name: 'IX_LogsSesion_Fecha_TTL', expireAfterSeconds: DIAS_LOGS_SESION * 86400 });

// -----------------------------------------------------------------------------
// eventos_seguridad: registro, cambio de clave, vinculacion de Google...
// `detalle` es un objeto (no texto) para poder consultarlo por campo.
// -----------------------------------------------------------------------------
db.createCollection('eventos_seguridad', {
  validationLevel: 'strict',
  validationAction: 'error',
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      title: 'eventos_seguridad',
      required: ['tipo', 'severidad', 'detalle', 'origen', 'fecha'],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'objectId' },
        tipo: { bsonType: 'string', pattern: '^[A-Z][A-Z0-9_]{1,59}$' },
        idUsuario: { bsonType: 'long', minimum: 1 },
        ip: { bsonType: 'string', minLength: 1, maxLength: 45 },
        severidad: { enum: ['INFO', 'ADVERTENCIA', 'CRITICO'] },
        detalle: { bsonType: 'object' },
        origen: { bsonType: 'string', minLength: 1, maxLength: 50 },
        fecha: { bsonType: 'date' },
      },
    },
  },
});
db.eventos_seguridad.createIndex({ idUsuario: 1, fecha: -1 }, { name: 'IX_EventosSeguridad_Usuario_Fecha' });
db.eventos_seguridad.createIndex({ tipo: 1, fecha: -1 }, { name: 'IX_EventosSeguridad_Tipo_Fecha' });

print('Colecciones creadas en goldorado_transacciones:');
for (const nombre of ['transacciones', 'logs_sesion', 'eventos_seguridad']) {
  print(`  ${nombre}: ${db.getCollection(nombre).getIndexes().map((i) => i.name).join(', ')}`);
}
