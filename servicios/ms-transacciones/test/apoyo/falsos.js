// =============================================================================
//  Dobles de prueba (sin base ni red). OJO: node --test ejecuta todo .js bajo
//  test/, asi que este modulo SOLO exporta: nada corre al importarlo.
//
//  - crearColeccionFalsa: lo minimo de una Collection de Mongo que usa el
//    repositorio de transacciones (findOne / findOneAndUpdate con upsert,
//    $setOnInsert, $set, $push), con la semantica del driver 6+ (devuelve el
//    documento o null).
//  - crearDbFalsa: lo minimo de una Db que usa asegurarEsquema.
//  - erroresEsquema: evalua el subconjunto de $jsonSchema que usa
//    src/esquema.js, para probar documentos contra los validadores reales.
// =============================================================================

const aNumeroSiPuede = (v) => (v !== null && typeof v === 'object' && typeof v.toNumber === 'function' ? v.toNumber() : v);
const igual = (a, b) => aNumeroSiPuede(a) === aNumeroSiPuede(b);
const copiar = (doc) => (doc ? { ...doc, historial: Array.isArray(doc.historial) ? [...doc.historial] : doc.historial } : null);

export function crearColeccionFalsa(iniciales = []) {
  const documentos = iniciales.map((d) => ({ ...d }));
  let escrituras = 0;
  let siguienteId = 1;
  const coincide = (doc, filtro) => Object.entries(filtro).every(([k, v]) => igual(doc[k], v));

  function aplicar(doc, cambios, insertando) {
    if (insertando && cambios.$setOnInsert) Object.assign(doc, cambios.$setOnInsert);
    if (cambios.$set) Object.assign(doc, cambios.$set);
    for (const [campo, valor] of Object.entries(cambios.$push ?? {})) doc[campo] = [...(doc[campo] ?? []), valor];
  }

  return {
    get documentos() {
      return documentos;
    },
    get escrituras() {
      return escrituras;
    },
    async findOne(filtro) {
      return copiar(documentos.find((d) => coincide(d, filtro)));
    },
    async findOneAndUpdate(filtro, cambios, { upsert = false, returnDocument = 'before' } = {}) {
      const doc = documentos.find((d) => coincide(d, filtro));
      if (!doc) {
        if (!upsert) return null;
        const nuevo = { _id: siguienteId++, ...filtro };
        aplicar(nuevo, cambios, true);
        documentos.push(nuevo);
        escrituras += 1;
        return returnDocument === 'after' ? copiar(nuevo) : null;
      }
      const antes = copiar(doc);
      if (cambios.$set || cambios.$push) {
        aplicar(doc, cambios, false);
        escrituras += 1;
      }
      return returnDocument === 'after' ? copiar(doc) : antes;
    },
  };
}

/**
 * @param {Record<string, {indices?: object[]}>} existentes  colecciones que ya estaban
 */
export function crearDbFalsa(existentes = {}, { sinPermisoCollMod = false } = {}) {
  const colecciones = new Map(
    Object.entries(existentes).map(([nombre, c]) => [
      nombre,
      { indices: [{ name: '_id_', key: { _id: 1 } }, ...(c.indices ?? [])], validador: null, documentos: c.documentos ?? 0 },
    ])
  );
  const registro = { creadas: [], borradas: [], comandos: [], indicesCreados: [] };

  return {
    colecciones,
    registro,
    listCollections: () => ({ toArray: async () => [...colecciones.keys()].map((name) => ({ name })) }),
    async createCollection(nombre, opciones) {
      if (colecciones.has(nombre)) throw Object.assign(new Error('Collection already exists'), { code: 48 });
      colecciones.set(nombre, { indices: [{ name: '_id_', key: { _id: 1 } }], validador: opciones.validator, documentos: 0 });
      registro.creadas.push(nombre);
    },
    async dropCollection(nombre) {
      if (!colecciones.delete(nombre)) throw Object.assign(new Error('ns not found'), { code: 26 });
      registro.borradas.push(nombre);
    },
    async command(comando) {
      registro.comandos.push(comando);
      if (comando.collMod && sinPermisoCollMod) {
        throw Object.assign(new Error('not authorized'), { code: 13 });
      }
      const coleccion = colecciones.get(comando.collMod);
      if (comando.validator) coleccion.validador = comando.validator;
      if (comando.index) {
        coleccion.indices.find((i) => i.name === comando.index.name).expireAfterSeconds = comando.index.expireAfterSeconds;
      }
      return { ok: 1 };
    },
    collection(nombre) {
      return {
        indexes: async () => colecciones.get(nombre).indices.map((i) => ({ ...i })),
        createIndex: async (key, opciones) => {
          colecciones.get(nombre).indices.push({ key, ...opciones });
          registro.indicesCreados.push(`${nombre}.${opciones.name}`);
          return opciones.name;
        },
      };
    },
  };
}

// --------------------------------------------------------- mini $jsonSchema

function tipoBson(valor) {
  if (valor === null) return 'null';
  if (valor === undefined) return 'undefined';
  if (valor instanceof Date) return 'date';
  if (Array.isArray(valor)) return 'array';
  const bson = valor?._bsontype;
  if (bson === 'Decimal128') return 'decimal';
  if (bson === 'Long') return 'long';
  if (bson === 'ObjectId') return 'objectId';
  if (typeof valor === 'boolean') return 'bool';
  if (typeof valor === 'string') return 'string';
  if (typeof valor === 'number') return Number.isInteger(valor) && Math.abs(valor) < 2 ** 31 ? 'int' : 'double';
  return typeof valor === 'object' ? 'object' : typeof valor;
}

/** Lista de violaciones (vacia = el documento entraria). */
export function erroresEsquema(valor, esquema, ruta = '$') {
  const errores = [];
  const tipo = tipoBson(valor);
  if (esquema.bsonType) {
    const permitidos = [].concat(esquema.bsonType);
    if (!permitidos.includes(tipo)) errores.push(`${ruta}: ${tipo} no es ${permitidos.join('|')}`);
  }
  if (esquema.enum && !esquema.enum.includes(valor)) errores.push(`${ruta}: ${valor} fuera de la lista`);
  if (tipo === 'string') {
    if (valor.length < (esquema.minLength ?? 0)) errores.push(`${ruta}: muy corto`);
    if (esquema.maxLength !== undefined && valor.length > esquema.maxLength) errores.push(`${ruta}: muy largo`);
    if (esquema.pattern && !new RegExp(esquema.pattern).test(valor)) errores.push(`${ruta}: no cumple el patron`);
  }
  if (['int', 'long', 'double', 'decimal'].includes(tipo) && esquema.minimum !== undefined) {
    const n = Number(valor.toString());
    if (esquema.exclusiveMinimum ? n <= esquema.minimum : n < esquema.minimum) errores.push(`${ruta}: ${n} bajo el minimo`);
  }
  if (tipo === 'array') {
    if (valor.length < (esquema.minItems ?? 0)) errores.push(`${ruta}: pocos elementos`);
    if (esquema.items) valor.forEach((v, i) => errores.push(...erroresEsquema(v, esquema.items, `${ruta}[${i}]`)));
  }
  if (tipo === 'object') {
    for (const clave of esquema.required ?? []) if (!(clave in valor)) errores.push(`${ruta}.${clave}: obligatorio`);
    for (const [clave, v] of Object.entries(valor)) {
      const sub = esquema.properties?.[clave];
      if (sub) errores.push(...erroresEsquema(v, sub, `${ruta}.${clave}`));
      else if (esquema.additionalProperties === false) errores.push(`${ruta}.${clave}: campo no declarado`);
    }
  }
  if (esquema.anyOf && !esquema.anyOf.some((alternativa) => erroresEsquema(valor, alternativa, ruta).length === 0)) {
    errores.push(`${ruta}: no cumple ninguna alternativa (anyOf)`);
  }
  return errores;
}
