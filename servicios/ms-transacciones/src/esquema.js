// =============================================================================
//  Esquema de goldorado_transacciones: validadores $jsonSchema + indices.
//
//  Se define UNA sola vez aqui y lo usan:
//   - src/index.js  al arrancar (asegurarEsquema): crea lo que falte y
//                   actualiza validadores e indices SIN borrar datos.
//   - db/setup.js   (recrearEsquema): borra y crea de cero para la demo.
//  db/01_colecciones.js es la copia legible para mongosh; una prueba vigila
//  que ambos tengan los mismos nombres.
//
//  En el monolito las garantias eran CHECK de SQL Server; en Mongo son
//  validadores con validationLevel 'strict' y validationAction 'error': un
//  documento que viole la regla NO entra (codigo 121), venga de este servicio
//  o de alguien tecleando en mongosh. La aplicacion valida antes como
//  comodidad (mensajes en espanol); la base es la garantia.
// =============================================================================

export const TIPOS_TRANSACCION = Object.freeze(['DEPOSITO', 'RETIRO', 'APUESTA', 'PREMIO', 'REEMBOLSO']);
export const ESTADOS_TRANSACCION = Object.freeze(['PENDIENTE', 'COMPLETADO', 'FALLIDO', 'REVERSADO']);
export const PROVEEDORES_SESION = Object.freeze(['LOCAL', 'GOOGLE', 'MICROSOFT']);
export const SEVERIDADES = Object.freeze(['INFO', 'ADVERTENCIA', 'CRITICO']);

// Tipo de evento: REGISTRO, CAMBIO_PASSWORD... sin enum cerrado para que un
// evento nuevo no exija migracion, pero con forma fija para que no entre basura.
export const PATRON_TIPO_EVENTO = '^[A-Z][A-Z0-9_]{1,59}$';

export const COLECCIONES = Object.freeze({
  transacciones: 'transacciones',
  logsSesion: 'logs_sesion',
  eventosSeguridad: 'eventos_seguridad',
});

const texto = (min, max) => ({ bsonType: 'string', minLength: min, maxLength: max });
// BIGINT de SQL Server -> long. Sin FK posible entre motores (CONVENCIONES §4).
const idUsuario = { bsonType: 'long', minimum: 1 };

// --------------------------------------------------------------- transacciones
// Antes: Transaccion + Log_Transaccion. El log va EMBEBIDO como `historial`
// porque siempre se lee junto con la transaccion, crece poco (una
// transaccion cambia de estado 2 o 3 veces) y asi el cambio de estado y su
// rastro se escriben en UNA operacion atomica sobre un solo documento.
const validadorTransacciones = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'transacciones',
    required: ['codigo', 'idUsuario', 'tipo', 'estado', 'monto', 'moneda', 'origen', 'creadoEn', 'actualizadoEn', 'historial'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      codigo: { ...texto(1, 150), description: 'clave de negocio unica: UUID de la apuesta o referencia del pago' },
      idUsuario: { ...idUsuario, description: 'Usuario.id_usuario (SQL Server)' },
      tipo: { enum: [...TIPOS_TRANSACCION], description: 'CHK_Transaccion_Tipo' },
      estado: { enum: [...ESTADOS_TRANSACCION], description: 'CHK_Transaccion_Estado' },
      // CHK_Transaccion_Monto: el signo lo da el tipo; una transaccion de 0 o negativa no existe.
      monto: { bsonType: 'decimal', minimum: 0, exclusiveMinimum: true, description: 'CHK_Transaccion_Monto' },
      moneda: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
      origen: texto(1, 50),
      referenciaExterna: texto(1, 150),
      proveedor: texto(1, 50),
      metodo: texto(1, 50),
      creadoEn: { bsonType: 'date' },
      actualizadoEn: { bsonType: 'date' },
      historial: {
        bsonType: 'array',
        minItems: 1, // toda transaccion nace con su primer registro
        items: {
          bsonType: 'object',
          required: ['estadoAnterior', 'estadoNuevo', 'fecha', 'ejecutadoPor'],
          additionalProperties: false,
          properties: {
            // null = la transaccion acaba de nacer, no venia de otro estado.
            estadoAnterior: { enum: [null, ...ESTADOS_TRANSACCION] },
            estadoNuevo: { enum: [...ESTADOS_TRANSACCION] },
            fecha: { bsonType: 'date' },
            ejecutadoPor: texto(1, 50),
            codigoError: texto(1, 50),
            payload: { bsonType: 'string' }, // JSON crudo de la pasarela: es evidencia, no se reinterpreta
          },
        },
      },
    },
  },
};

// ----------------------------------------------------------------- logs_sesion
const validadorLogsSesion = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'logs_sesion',
    required: ['idUsuario', 'emailIntento', 'ip', 'exitoso', 'proveedor', 'fecha'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      // NULL a proposito: un intento con un correo inexistente no tiene usuario,
      // y justo esa traza es la que delata un ataque de fuerza bruta.
      idUsuario: { bsonType: ['long', 'null'], minimum: 1 },
      emailIntento: texto(1, 150), // lo que se tecleo, exista o no la cuenta
      ip: texto(1, 45), // 45 = largo maximo de una IPv6
      userAgent: texto(1, 255),
      exitoso: { bsonType: 'bool' },
      motivoFallo: texto(1, 100),
      proveedor: { enum: [...PROVEEDORES_SESION] },
      fecha: { bsonType: 'date' },
    },
    // CHK_LogSesion_Motivo (exitoso = 1 OR motivo_fallo IS NOT NULL):
    // un intento fallido SIEMPRE tiene que decir por que fallo.
    anyOf: [{ properties: { exitoso: { enum: [true] } } }, { required: ['motivoFallo'] }],
  },
};

// ----------------------------------------------------------- eventos_seguridad
const validadorEventos = {
  $jsonSchema: {
    bsonType: 'object',
    title: 'eventos_seguridad',
    required: ['tipo', 'severidad', 'detalle', 'origen', 'fecha'],
    additionalProperties: false,
    properties: {
      _id: { bsonType: 'objectId' },
      tipo: { bsonType: 'string', pattern: PATRON_TIPO_EVENTO },
      idUsuario,
      ip: texto(1, 45),
      severidad: { enum: [...SEVERIDADES] },
      detalle: { bsonType: 'object' }, // objeto (no texto) para poder consultarlo por campo
      origen: texto(1, 50),
      fecha: { bsonType: 'date' },
    },
  },
};

/**
 * TTL en segundos. Un valor no positivo o basura vuelve a 180 dias (nunca
 * a 1: un error de configuracion no debe borrar la auditoria), y se acota
 * al rango que Mongo acepta (entero de 32 bits).
 */
export function segundosTtl(dias) {
  const n = Math.trunc(Number(dias));
  return (n > 0 ? Math.min(n, 24855) : 180) * 86400;
}

/**
 * Definicion completa de las 3 colecciones. Los indices llevan nombre
 * (UQ_/IX_) igual que las restricciones del monolito, para poder citarlos en
 * explain() y en la sustentacion.
 */
export function definirColecciones({ diasLogsSesion = 180 } = {}) {
  return [
    {
      nombre: COLECCIONES.transacciones,
      validador: validadorTransacciones,
      indices: [
        // La idempotencia de RegistrarTransaccion descansa en este indice.
        { nombre: 'UQ_Transacciones_Codigo', llave: { codigo: 1 }, opciones: { unique: true } },
        // "Mis movimientos": por usuario, mas recientes primero.
        { nombre: 'IX_Transacciones_Usuario_Fecha', llave: { idUsuario: 1, creadoEn: -1 } },
        // Conciliacion y reportes: pendientes/fallidas de un tipo por fecha.
        { nombre: 'IX_Transacciones_Tipo_Estado_Fecha', llave: { tipo: 1, estado: 1, creadoEn: -1 } },
      ],
    },
    {
      nombre: COLECCIONES.logsSesion,
      validador: validadorLogsSesion,
      indices: [
        // Fuerza bruta: "intentos con este correo en los ultimos 15 minutos".
        { nombre: 'IX_LogsSesion_Email_Fecha', llave: { emailIntento: 1, fecha: -1 } },
        { nombre: 'IX_LogsSesion_Usuario_Fecha', llave: { idUsuario: 1, fecha: -1 } },
        // TTL: Mongo borra solo los logs viejos (en SQL Server hacia falta un job).
        { nombre: 'IX_LogsSesion_Fecha_TTL', llave: { fecha: 1 }, opciones: { expireAfterSeconds: segundosTtl(diasLogsSesion) } },
      ],
    },
    {
      nombre: COLECCIONES.eventosSeguridad,
      validador: validadorEventos,
      indices: [
        { nombre: 'IX_EventosSeguridad_Usuario_Fecha', llave: { idUsuario: 1, fecha: -1 } },
        { nombre: 'IX_EventosSeguridad_Tipo_Fecha', llave: { tipo: 1, fecha: -1 } },
      ],
    },
  ];
}

const opcionesValidacion = (def) => ({
  validator: def.validador,
  validationLevel: 'strict',
  validationAction: 'error',
});

// Codigos del servidor que se toleran sin tumbar el arranque.
const YA_EXISTE_COLECCION = 48;
const NO_EXISTE = 26;
const SIN_PERMISO = 13;
const CONFLICTO_INDICE = new Set([85, 86]);

/**
 * Deja las colecciones como las define este archivo SIN borrar nada.
 * Idempotente: se puede correr en cada arranque. Si falta un permiso
 * (p. ej. collMod con un usuario readWrite de Atlas) solo avisa: los datos
 * siguen protegidos por el validador que ya tenga la coleccion.
 * Lanza solo errores de conexion u otros inesperados (el llamador reintenta).
 */
export async function asegurarEsquema(db, { log, diasLogsSesion } = {}) {
  const existentes = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  );

  for (const def of definirColecciones({ diasLogsSesion })) {
    let crear = !existentes.has(def.nombre);
    if (crear) {
      try {
        await db.createCollection(def.nombre, opcionesValidacion(def));
        log?.info(`Coleccion ${def.nombre} creada con su validador`);
      } catch (error) {
        if (error?.code !== YA_EXISTE_COLECCION) throw error;
        crear = false; // otro proceso la creo en el mismo instante
      }
    }
    if (!crear) await actualizarValidador(db, def, log);
    await asegurarIndices(db, def, log);
  }
}

async function actualizarValidador(db, def, log) {
  try {
    await db.command({ collMod: def.nombre, ...opcionesValidacion(def) });
  } catch (error) {
    if (error?.code !== SIN_PERMISO) throw error;
    log?.aviso(`Sin permiso para actualizar el validador de ${def.nombre} (collMod); corre "npm run db:setup" con un usuario administrador`);
  }
}

async function asegurarIndices(db, def, log) {
  const coleccion = db.collection(def.nombre);
  const actuales = await coleccion.indexes();

  for (const indice of def.indices) {
    const actual = actuales.find((i) => i.name === indice.nombre);
    const ttl = indice.opciones?.expireAfterSeconds;
    try {
      if (!actual) {
        await coleccion.createIndex(indice.llave, { name: indice.nombre, ...indice.opciones });
      } else if (ttl !== undefined && actual.expireAfterSeconds !== ttl) {
        // Cambio LOGS_SESION_DIAS: el TTL se ajusta en sitio, sin reconstruir el indice.
        await db.command({ collMod: def.nombre, index: { name: indice.nombre, expireAfterSeconds: ttl } });
        log?.info(`TTL de ${def.nombre} ajustado a ${ttl / 86400} dias`);
      }
    } catch (error) {
      if (!CONFLICTO_INDICE.has(error?.code) && error?.code !== SIN_PERMISO) throw error;
      // Alguien creo a mano el mismo indice con otro nombre u opciones: se respeta y se avisa.
      log?.aviso(`No se pudo asegurar el indice ${indice.nombre} de ${def.nombre}: ${error.message}`);
    }
  }
}

/** Solo para db/setup.js: borra las 3 colecciones y las crea de cero. */
export async function recrearEsquema(db, { log, diasLogsSesion } = {}) {
  for (const def of definirColecciones({ diasLogsSesion })) {
    try {
      await db.dropCollection(def.nombre);
    } catch (error) {
      if (error?.code !== NO_EXISTE && !/ns not found/i.test(error?.message ?? '')) throw error;
    }
  }
  await asegurarEsquema(db, { log, diasLogsSesion });
}
