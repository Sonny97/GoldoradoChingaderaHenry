/**
 * Latencia artificial para la capa de servicios mock.
 *
 * Existe para que los estados de carga sean visibles durante el desarrollo:
 * un servicio que resuelve instantaneamente esconde spinners rotos y hace que
 * las carreras de respuestas fuera de orden sean irreproducibles.
 */

export const delay = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomDelay = (min = 320, max = 680) =>
  delay(Math.floor(Math.random() * (max - min + 1)) + min);
