// =============================================================================
//  02_datos.js  ·  goldorado_transacciones  ·  mongosh
//
//  Semilla de CONVENCIONES §5 ("Transacciones y seguridad"); es la misma de
//  db/semilla.js (la que carga `npm run db:setup`).
//  Uso: mongosh "mongodb://localhost:27017" db/02_datos.js   (despues de 01)
//
//  Tipos explicitos, como las columnas del monolito:
//    NumberLong    = BIGINT (ids de Usuario en SQL Server)
//    NumberDecimal = DECIMAL(18,2) (dinero: nunca double)
//    ISODate       = DATETIME2
//  Fechas RELATIVAS al dia en que se corre (mismos dias relativos y horas de
//  Bogota que el monolito: 15/08 -> hace 4 dias ... 18/08 -> hace 1 dia): con
//  fechas fijas, el TTL de logs_sesion borraria la semilla con el tiempo.
// =============================================================================

db = db.getSiblingDB('goldorado_transacciones');

/** ISODate de "hace N dias a las HH:MM de Bogota" (UTC-5, sin horario de verano). */
function haceDias(dias, hhmm) {
  const [hora, minuto] = hhmm.split(':').map(Number);
  const enBogota = new Date(Date.now() - 5 * 3600000);
  const utc = Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), enBogota.getUTCDate() - dias, hora + 5, minuto);
  return ISODate(new Date(utc).toISOString());
}

// monto siempre positivo: el signo lo da el tipo. Un deposito trae proveedor y
// metodo (entro dinero de afuera); una apuesta es interna y no los lleva.
// Los codigos b3a1c0de-... son apuesta.id_transaccion en PostgreSQL y los
// GD-SEED-000x son pagos/{referencia} en Firestore.
db.transacciones.insertMany([
  {
    codigo: 'GD-SEED-0001',
    idUsuario: NumberLong(1),
    tipo: 'DEPOSITO',
    estado: 'COMPLETADO',
    monto: NumberDecimal('300000.00'),
    moneda: 'COP',
    origen: 'ms-pagos',
    referenciaExterna: 'WOMPI-2026-0001',
    proveedor: 'Wompi',
    metodo: 'NEQUI',
    creadoEn: haceDias(4, '09:12'),
    actualizadoEn: haceDias(4, '09:13'),
    historial: [
      { estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: haceDias(4, '09:12'), ejecutadoPor: 'SISTEMA' },
      {
        estadoAnterior: 'PENDIENTE',
        estadoNuevo: 'COMPLETADO',
        fecha: haceDias(4, '09:13'),
        ejecutadoPor: 'WOMPI_WEBHOOK',
        payload: '{"ref":"WOMPI-2026-0001","status":"APPROVED"}',
      },
    ],
  },
  {
    codigo: 'b3a1c0de-0001-4a00-9000-000000000001',
    idUsuario: NumberLong(1),
    tipo: 'APUESTA',
    estado: 'COMPLETADO',
    monto: NumberDecimal('50000.00'),
    moneda: 'COP',
    origen: 'ms-apuestas',
    creadoEn: haceDias(2, '20:05'),
    actualizadoEn: haceDias(2, '20:05'),
    historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha: haceDias(2, '20:05'), ejecutadoPor: 'APUESTA_WEB' }],
  },
  {
    codigo: 'GD-SEED-0002',
    idUsuario: NumberLong(2),
    tipo: 'DEPOSITO',
    estado: 'COMPLETADO',
    monto: NumberDecimal('100000.00'),
    moneda: 'COP',
    origen: 'ms-pagos',
    referenciaExterna: 'WOMPI-2026-0042',
    proveedor: 'Wompi',
    metodo: 'PSE',
    creadoEn: haceDias(3, '18:40'),
    actualizadoEn: haceDias(3, '18:44'),
    historial: [
      { estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: haceDias(3, '18:40'), ejecutadoPor: 'SISTEMA' },
      {
        estadoAnterior: 'PENDIENTE',
        estadoNuevo: 'COMPLETADO',
        fecha: haceDias(3, '18:44'),
        ejecutadoPor: 'WOMPI_WEBHOOK',
        payload: '{"ref":"WOMPI-2026-0042","status":"APPROVED"}',
      },
    ],
  },
  {
    codigo: 'b3a1c0de-0002-4a00-9000-000000000002',
    idUsuario: NumberLong(2),
    tipo: 'APUESTA',
    estado: 'COMPLETADO',
    monto: NumberDecimal('15500.00'),
    moneda: 'COP',
    origen: 'ms-apuestas',
    creadoEn: haceDias(1, '11:20'),
    actualizadoEn: haceDias(1, '11:20'),
    historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha: haceDias(1, '11:20'), ejecutadoPor: 'APUESTA_WEB' }],
  },
]);

// Los tres casos que el monolito registraba en cada intento de acceso + el
// login con Google del usuario 4. El tercero tiene idUsuario null: nadie
// tecleo un correo que exista, y aun asi queda la traza.
db.logs_sesion.insertMany([
  {
    idUsuario: NumberLong(1),
    emailIntento: 'demo@goldorado.co',
    ip: '127.0.0.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
    exitoso: true,
    proveedor: 'LOCAL',
    fecha: haceDias(2, '20:01'),
  },
  {
    idUsuario: NumberLong(2),
    emailIntento: 'valentina.mesa@hotmail.com',
    ip: '190.85.12.44',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1',
    exitoso: false,
    motivoFallo: 'Contraseña incorrecta',
    proveedor: 'LOCAL',
    fecha: haceDias(1, '11:15'),
  },
  {
    idUsuario: null,
    emailIntento: 'noexiste@goldorado.co',
    ip: '45.132.90.7',
    userAgent: 'curl/8.5.0',
    exitoso: false,
    motivoFallo: 'Usuario no encontrado',
    proveedor: 'LOCAL',
    fecha: haceDias(1, '03:22'),
  },
  {
    idUsuario: NumberLong(4),
    emailIntento: 'andres.gomez.demo@gmail.com',
    ip: '181.52.88.10',
    userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131.0',
    exitoso: true,
    proveedor: 'GOOGLE',
    fecha: haceDias(3, '19:45'),
  },
]);

db.eventos_seguridad.insertMany([
  {
    tipo: 'REGISTRO',
    idUsuario: NumberLong(1),
    ip: '127.0.0.1',
    severidad: 'INFO',
    detalle: { email: 'demo@goldorado.co', proveedor: 'LOCAL' },
    origen: 'ms-autenticacion',
    fecha: haceDias(5, '10:00'),
  },
  {
    tipo: 'REGISTRO',
    idUsuario: NumberLong(2),
    ip: '190.85.12.44',
    severidad: 'INFO',
    detalle: { email: 'valentina.mesa@hotmail.com', proveedor: 'LOCAL' },
    origen: 'ms-autenticacion',
    fecha: haceDias(4, '17:30'),
  },
  {
    tipo: 'CUENTA_EXTERNA_VINCULADA',
    idUsuario: NumberLong(4),
    ip: '181.52.88.10',
    severidad: 'INFO',
    detalle: { proveedor: 'GOOGLE', sub: '100000000000000000004', email: 'andres.gomez.demo@gmail.com' },
    origen: 'ms-autenticacion',
    fecha: haceDias(3, '19:45'),
  },
]);

// Verificacion: regla del taller, minimo 2 documentos por coleccion.
for (const nombre of ['transacciones', 'logs_sesion', 'eventos_seguridad']) {
  const total = db.getCollection(nombre).countDocuments();
  print(`${nombre.padEnd(20)} ${String(total).padStart(3)} documentos  ${total >= 2 ? 'OK' : 'FALTA (minimo 2)'}`);
}
