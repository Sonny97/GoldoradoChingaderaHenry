/**
 * Variables de entorno de ms-imagenes, validadas UNA vez al arrancar.
 *
 * Por defecto el almacen es LOCAL (carpeta storage/): se puede desarrollar
 * sin cuenta de Google. Con IMAGENES_ALMACEN=drive las credenciales que exige
 * cada modo de autenticacion se revisan aqui mismo (requisitosDrive), porque
 * cargarEnv no sabe de variables "obligatorias segun otra variable". Un .env
 * a medias detiene el proceso en el segundo cero con la lista de lo que falta;
 * en cambio, un Drive caido o una llave vencida NO lo detienen: eso lo
 * reporta Salud (igual que una base caida en los otros servicios).
 */

import { cargarEnv } from '@goldorado/comun';
import { requisitosDrive } from './requisitos.js';

export const env = cargarEnv(import.meta.url, {
  // ------------------------------------------------------------ servidor gRPC
  GRPC_PUERTO: { tipo: 'entero', defecto: 50056 },
  GRPC_HOST: { tipo: 'texto', defecto: '0.0.0.0' },
  // Vacio = sin token. Si tiene valor, debe ser el mismo en los 7 procesos.
  GRPC_TOKEN_INTERNO: { tipo: 'texto', defecto: '', secreta: true },

  // ---------------------------------------------------------------- almacen
  IMAGENES_ALMACEN: { tipo: 'texto', defecto: 'local', valores: ['local', 'drive'] },
  // Relativa a la carpeta del servicio (servicios/ms-imagenes). Esta en .gitignore.
  IMAGENES_DIR_LOCAL: { tipo: 'texto', defecto: './storage' },
  // 5 MB: el cliente de Drive para Node sube siempre en "multipart" (tope 5 MB)
  // y el canal gRPC admite mensajes de hasta 8 MB.
  IMAGENES_MAX_BYTES: { tipo: 'entero', defecto: 5 * 1024 * 1024 },
  // Cache LRU de bytes descargados de Drive (cada descarga cuesta 200 unidades de cuota).
  IMAGENES_CACHE_BYTES: { tipo: 'entero', defecto: 20 * 1024 * 1024 },

  // ------------------------------------------------------------ Google Drive
  DRIVE_AUTENTICACION: { tipo: 'texto', defecto: 'oauth', valores: ['oauth', 'cuenta_servicio'] },
  // Opcion A (cuenta @gmail.com): OAuth con refresh token y scope drive.file.
  DRIVE_OAUTH_CLIENT_ID: { tipo: 'texto', defecto: '' },
  DRIVE_OAUTH_CLIENT_SECRET: { tipo: 'texto', defecto: '', secreta: true },
  DRIVE_OAUTH_REFRESH_TOKEN: { tipo: 'texto', defecto: '', secreta: true },
  // Opcion B (Workspace): llave JSON de la cuenta de servicio + unidad compartida.
  GOOGLE_DRIVE_CREDENCIALES: { tipo: 'texto', defecto: './credenciales/drive.json' },
  DRIVE_UNIDAD_COMPARTIDA_ID: { tipo: 'texto', defecto: '' },
  // Id de la carpeta "GolDorado - Imagenes" (lo imprime npm run db:setup).
  // Vacio = se busca por appProperties y, si no existe, se crea por la API.
  DRIVE_CARPETA_RAIZ_ID: { tipo: 'texto', defecto: '' },
  // Cada cuanto se reconstruye el indice en memoria desde Drive.
  DRIVE_INDICE_REFRESCO_MS: { tipo: 'entero', defecto: 5 * 60 * 1000 },
});

const faltantes = requisitosDrive(env);
if (faltantes.length > 0) {
  console.error(
    `\n[ms-imagenes] Configuracion invalida para IMAGENES_ALMACEN=drive:\n  - ${faltantes.join('\n  - ')}\n` +
      '\nVer docs/GOOGLE-MICROSOFT-DRIVE.md seccion 4, o usa IMAGENES_ALMACEN=local para desarrollar sin Drive.\n'
  );
  process.exit(1);
}
