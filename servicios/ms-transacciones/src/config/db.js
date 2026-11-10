// =============================================================================
//  UNA conexion a MongoDB para todo el proceso (el MongoClient trae su pool).
//
//  El servicio arranca aunque Mongo este caido (CONVENCIONES §2): el driver
//  se conecta solo en la primera operacion, y aqui un intento de fondo hace
//  ping + asegurarEsquema y se reprograma hasta lograrlo. Mientras tanto cada
//  RPC falla rapido con UNAVAILABLE (serverSelectionTimeoutMS corto) y Salud
//  lo dice, en vez de dejar al llamador colgado 30 s.
// =============================================================================

import { MongoClient } from 'mongodb';

const ESPERA_SELECCION_MS = 2000; // menor que el plazo de Salud (2500 ms)
const REINTENTO_INICIAL_MS = 5000;
const REINTENTO_MAXIMO_MS = 60000;

/** Quita usuario y clave de la cadena para poder imprimirla en un log. */
export function uriSinCredenciales(uri) {
  return String(uri).replace(/\/\/[^@/]*@/, '//****@');
}

/**
 * @param {object} o
 * @param {string} o.uri
 * @param {string} o.nombreBase
 * @param {object} o.log
 * @param {(db: import('mongodb').Db) => Promise<void>} [o.alConectar]  p. ej. asegurarEsquema
 */
export function crearConexion({ uri, nombreBase, log, alConectar }) {
  const cliente = new MongoClient(uri, {
    appName: 'ms-transacciones',
    serverSelectionTimeoutMS: ESPERA_SELECCION_MS,
    // Mas holgado que la seleccion: en Atlas, TLS + autenticacion de una
    // conexion nueva puede pasar de 2 s; con Mongo caido igual falla a los 2 s.
    connectTimeoutMS: 5000,
    maxPoolSize: 20,
  });
  const db = cliente.db(nombreBase);
  const estado = { conectada: false, esquemaListo: false };
  let temporizador = null;
  let cerrada = false;
  let fallos = 0;

  async function intentar() {
    temporizador = null;
    if (cerrada) return;
    try {
      await db.command({ ping: 1 });
      estado.conectada = true;
      await alConectar?.(db);
      estado.esquemaListo = true;
      log.info(`MongoDB listo: ${uriSinCredenciales(uri)} / ${nombreBase} (colecciones, validadores e indices verificados)`);
    } catch (error) {
      if (cerrada) return;
      fallos += 1;
      const espera = Math.min(REINTENTO_INICIAL_MS * 2 ** (fallos - 1), REINTENTO_MAXIMO_MS);
      const mensaje = `No se pudo preparar MongoDB en ${uriSinCredenciales(uri)} (${error?.message ?? error}).`;
      if (fallos === 1) {
        log.aviso(
          `${mensaje} El servicio sigue arriba y reintenta solo. ` +
            '¿Esta corriendo Mongo? Local: mongod | docker compose up -d mongo | Atlas: revisa MONGO_URI y la IP permitida.'
        );
      } else {
        log.debug(`${mensaje} Nuevo intento en ${espera / 1000} s`);
      }
      temporizador = setTimeout(intentar, espera);
      temporizador.unref(); // un reintento pendiente no debe impedir que el proceso termine
    }
  }

  return {
    estado,
    db,
    coleccion: (nombre) => db.collection(nombre),
    /** Para Salud: falla en ~2 s si Mongo no responde. */
    ping: () => db.command({ ping: 1 }),
    /** No bloquea: el primer intento sale ya, los siguientes con espera creciente. */
    conectarEnSegundoPlano() {
      if (!temporizador && !estado.esquemaListo) void intentar();
    },
    async cerrar() {
      cerrada = true;
      if (temporizador) clearTimeout(temporizador);
      await cliente.close();
    },
  };
}
