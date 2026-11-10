// =============================================================================
//  Datos semilla de goldorado_transacciones (CONVENCIONES §5, "Transacciones
//  y seguridad"), ya con los tipos del driver (Long, Decimal128, Date).
//  Lo usa db/setup.js; db/02_datos.js es la misma semilla para mongosh.
//
//  Ids y codigos FIJOS: son las referencias que comparten las otras bases
//  (Usuario 1, 2 y 4 en SQL Server; apuesta.id_transaccion en PostgreSQL;
//  pagos/GD-SEED-000x en Firestore).
//
//  Las FECHAS son relativas al dia en que se corre el seed (mismos dias
//  relativos y horas de Bogota que el monolito: 15/08 -> hace 4 dias ...
//  18/08 -> hace 1 dia). Dos motivos: el indice TTL de logs_sesion borraria
//  una semilla con fechas fijas apenas pasaran LOGS_SESION_DIAS, y la demo
//  no debe mostrar movimientos de hace meses.
// =============================================================================

import { Decimal128, Long } from 'mongodb';

const DESFASE_BOGOTA_H = -5; // Colombia no tiene horario de verano

/** Fecha "hace N dias a las HH:MM de Bogota", relativa a `ahora`. */
export function haceDias(dias, hhmm, ahora = new Date()) {
  const [hora, minuto] = hhmm.split(':').map(Number);
  const enBogota = new Date(ahora.getTime() + DESFASE_BOGOTA_H * 3_600_000);
  return new Date(
    Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), enBogota.getUTCDate() - dias, hora - DESFASE_BOGOTA_H, minuto)
  );
}

const pesos = (valor) => Decimal128.fromString(valor);
const usuario = (id) => Long.fromNumber(id);

export const CODIGOS_SEMILLA = Object.freeze([
  'GD-SEED-0001',
  'b3a1c0de-0001-4a00-9000-000000000001',
  'GD-SEED-0002',
  'b3a1c0de-0002-4a00-9000-000000000002',
]);

export function documentosSemilla(ahora = new Date()) {
  const f = (dias, hhmm) => haceDias(dias, hhmm, ahora);

  // monto siempre positivo: el signo lo da el tipo. Un deposito trae
  // proveedor y metodo (entro dinero de afuera); una apuesta es un movimiento
  // interno y no los lleva. Los depositos nacen PENDIENTE y los aprueba el
  // webhook de Wompi (dos entradas de historial); la apuesta nace COMPLETADO.
  const transacciones = [
    {
      codigo: 'GD-SEED-0001',
      idUsuario: usuario(1),
      tipo: 'DEPOSITO',
      estado: 'COMPLETADO',
      monto: pesos('300000.00'),
      moneda: 'COP',
      origen: 'ms-pagos',
      referenciaExterna: 'WOMPI-2026-0001',
      proveedor: 'Wompi',
      metodo: 'NEQUI',
      creadoEn: f(4, '09:12'),
      actualizadoEn: f(4, '09:13'),
      historial: [
        { estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: f(4, '09:12'), ejecutadoPor: 'SISTEMA' },
        {
          estadoAnterior: 'PENDIENTE',
          estadoNuevo: 'COMPLETADO',
          fecha: f(4, '09:13'),
          ejecutadoPor: 'WOMPI_WEBHOOK',
          payload: '{"ref":"WOMPI-2026-0001","status":"APPROVED"}',
        },
      ],
    },
    {
      codigo: 'b3a1c0de-0001-4a00-9000-000000000001',
      idUsuario: usuario(1),
      tipo: 'APUESTA',
      estado: 'COMPLETADO',
      monto: pesos('50000.00'),
      moneda: 'COP',
      origen: 'ms-apuestas',
      creadoEn: f(2, '20:05'),
      actualizadoEn: f(2, '20:05'),
      historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha: f(2, '20:05'), ejecutadoPor: 'APUESTA_WEB' }],
    },
    {
      codigo: 'GD-SEED-0002',
      idUsuario: usuario(2),
      tipo: 'DEPOSITO',
      estado: 'COMPLETADO',
      monto: pesos('100000.00'),
      moneda: 'COP',
      origen: 'ms-pagos',
      referenciaExterna: 'WOMPI-2026-0042',
      proveedor: 'Wompi',
      metodo: 'PSE',
      creadoEn: f(3, '18:40'),
      actualizadoEn: f(3, '18:44'),
      historial: [
        { estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: f(3, '18:40'), ejecutadoPor: 'SISTEMA' },
        {
          estadoAnterior: 'PENDIENTE',
          estadoNuevo: 'COMPLETADO',
          fecha: f(3, '18:44'),
          ejecutadoPor: 'WOMPI_WEBHOOK',
          payload: '{"ref":"WOMPI-2026-0042","status":"APPROVED"}',
        },
      ],
    },
    {
      codigo: 'b3a1c0de-0002-4a00-9000-000000000002',
      idUsuario: usuario(2),
      tipo: 'APUESTA',
      estado: 'COMPLETADO',
      monto: pesos('15500.00'),
      moneda: 'COP',
      origen: 'ms-apuestas',
      creadoEn: f(1, '11:20'),
      actualizadoEn: f(1, '11:20'),
      historial: [{ estadoAnterior: null, estadoNuevo: 'COMPLETADO', fecha: f(1, '11:20'), ejecutadoPor: 'APUESTA_WEB' }],
    },
  ];

  // Los tres casos que el monolito registraba en cada intento de acceso + el
  // login con Google del usuario 4. El tercero tiene idUsuario null: nadie
  // tecleo un correo que exista, y aun asi queda la traza.
  const logsSesion = [
    {
      idUsuario: usuario(1),
      emailIntento: 'demo@goldorado.co',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
      exitoso: true,
      proveedor: 'LOCAL',
      fecha: f(2, '20:01'),
    },
    {
      idUsuario: usuario(2),
      emailIntento: 'valentina.mesa@hotmail.com',
      ip: '190.85.12.44',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/605.1',
      exitoso: false,
      motivoFallo: 'Contraseña incorrecta',
      proveedor: 'LOCAL',
      fecha: f(1, '11:15'),
    },
    {
      idUsuario: null,
      emailIntento: 'noexiste@goldorado.co',
      ip: '45.132.90.7',
      userAgent: 'curl/8.5.0',
      exitoso: false,
      motivoFallo: 'Usuario no encontrado',
      proveedor: 'LOCAL',
      fecha: f(1, '03:22'),
    },
    {
      idUsuario: usuario(4),
      emailIntento: 'andres.gomez.demo@gmail.com',
      ip: '181.52.88.10',
      userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/131.0',
      exitoso: true,
      proveedor: 'GOOGLE',
      fecha: f(3, '19:45'),
    },
  ];

  const eventosSeguridad = [
    {
      tipo: 'REGISTRO',
      idUsuario: usuario(1),
      ip: '127.0.0.1',
      severidad: 'INFO',
      detalle: { email: 'demo@goldorado.co', proveedor: 'LOCAL' },
      origen: 'ms-autenticacion',
      fecha: f(5, '10:00'),
    },
    {
      tipo: 'REGISTRO',
      idUsuario: usuario(2),
      ip: '190.85.12.44',
      severidad: 'INFO',
      detalle: { email: 'valentina.mesa@hotmail.com', proveedor: 'LOCAL' },
      origen: 'ms-autenticacion',
      fecha: f(4, '17:30'),
    },
    {
      tipo: 'CUENTA_EXTERNA_VINCULADA',
      idUsuario: usuario(4),
      ip: '181.52.88.10',
      severidad: 'INFO',
      detalle: { proveedor: 'GOOGLE', sub: '100000000000000000004', email: 'andres.gomez.demo@gmail.com' },
      origen: 'ms-autenticacion',
      fecha: f(3, '19:45'),
    },
  ];

  return { transacciones, logsSesion, eventosSeguridad };
}
