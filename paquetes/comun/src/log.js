/**
 * Logger minimo con el nombre del servicio como prefijo.
 *
 * Con ocho procesos escribiendo en la misma terminal (npm run dev), una linea
 * sin prefijo no dice de quien es. `concurrently` antepone un nombre, pero si
 * el servicio se arranca solo, el prefijo propio sigue ahi.
 *
 * LOG_NIVEL=debug muestra ademas cada llamada gRPC con su duracion.
 */

const hora = () => new Date().toISOString().slice(11, 23);

export function crearLogger(servicio) {
  const prefijo = `[${servicio}]`;
  const depurar = () => (process.env.LOG_NIVEL ?? '').toLowerCase() === 'debug';

  return {
    info: (...partes) => console.log(hora(), prefijo, ...partes),
    aviso: (...partes) => console.warn(hora(), prefijo, 'AVISO', ...partes),
    error: (...partes) => console.error(hora(), prefijo, 'ERROR', ...partes),
    debug: (...partes) => {
      if (depurar()) console.log(hora(), prefijo, 'debug', ...partes);
    },
  };
}
