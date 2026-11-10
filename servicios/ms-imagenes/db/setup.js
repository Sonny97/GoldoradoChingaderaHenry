/**
 * npm run db:setup  ·  "crea la base" de imagenes y carga los datos semilla.
 *
 * En Drive no hay CREATE TABLE: preparar el almacen es crear la carpeta raiz
 * "GolDorado - Imagenes" (POR LA API: con el scope drive.file una carpeta
 * creada a mano en la web no es visible para la app) y sus 6 subcarpetas.
 * Los "datos semilla" son los 16 escudos SVG de los equipos semilla, generados
 * con los mismos colores y crest_seed que el escudo CSS del monolito.
 *
 * Se puede correr las veces que se quiera: cada escudo se sube con
 * reemplazar=true, asi que la imagen anterior de ese equipo se borra (Drive:
 * va a la papelera) y siempre queda UNA vigente por equipo.
 *
 * Usa el mismo .env, almacen y validaciones que el servicio: si un escudo no
 * pasara la validacion de SVG, el setup fallaria igual que una subida real.
 */

import { env } from '../src/config/env.js';
import { modoAlmacen } from '../src/config/requisitos.js';
import { crearAlmacen } from '../src/almacenes/index.js';
import { crearServicioImagenes } from '../src/servicios/imagenServicio.js';
import { EQUIPOS } from './equipos.js';
import { escudoSvg } from './escudo.js';

const log = {
  info: (...p) => console.log(...p),
  aviso: (...p) => console.warn('AVISO', ...p),
  error: (...p) => console.error('ERROR', ...p),
  debug: () => {},
};

const modo = modoAlmacen(env);
const almacen = crearAlmacen({ env, log });
const imagenes = crearServicioImagenes({ almacen, log, maxBytes: env.IMAGENES_MAX_BYTES });

let codigoSalida = 0;
try {
  console.log(`ms-imagenes · db:setup · almacen ${modo}`);
  const preparado = await almacen.preparar();
  console.log(modo === 'local' ? `Carpeta local: ${preparado.dir}` : `Carpeta raiz en Drive: ${preparado.raizId}`);

  for (const equipo of EQUIPOS) {
    const imagen = await imagenes.subir({
      entidad: 'equipo',
      idEntidad: String(equipo.id),
      nombre: `escudo-${equipo.codigo.toLowerCase()}.svg`,
      tipoMime: 'image/svg+xml',
      contenido: Buffer.from(escudoSvg(equipo), 'utf8'),
      descripcion: `Escudo de ${equipo.nombre} (${equipo.codigo})`,
      reemplazar: true,
      subidoPor: 0,
    });
    console.log(`  equipo ${String(equipo.id).padStart(2)} ${equipo.codigo}  ${imagen.id}  ${imagen.tamanoBytes} bytes`);
  }

  // Verificacion (como el SELECT del final de los 02_datos.sql): una vigente por equipo.
  const vigentes = await almacen.buscar('equipo', EQUIPOS.map((e) => String(e.id)));
  console.log(`Verificacion: ${vigentes.length}/${EQUIPOS.length} equipos con escudo vigente`);
  if (vigentes.length !== EQUIPOS.length) codigoSalida = 1;

  if (modo !== 'local') {
    console.log('\nCopia esta linea en servicios/ms-imagenes/.env para no buscar la carpeta en cada arranque:');
    console.log(`DRIVE_CARPETA_RAIZ_ID=${preparado.raizId}`);
  }
} catch (error) {
  codigoSalida = 1;
  console.error(`\nERROR en db:setup: ${error?.message ?? error}`);
  if (error?.pista) console.error(`PISTA: ${error.pista}`);
} finally {
  await almacen.cerrar();
}
process.exit(codigoSalida);
