/**
 * Variables de entorno del BFF, validadas UNA vez al arrancar.
 *
 * Los nombres son los de docs/CONVENCIONES.md (seccion 6). Este modulo SOLO lo
 * importa src/index.js: crearApp() recibe el entorno ya armado, y asi las
 * pruebas construyen la app con un objeto propio sin tocar process.env ni
 * depender de un .env en disco.
 *
 * Ninguna variable es obligatoria en desarrollo: con los valores por defecto el
 * BFF habla con los seis servicios en localhost:50051..50056, que es lo que
 * deja `npm run dev` en la raiz del monorepo. COOKIE_SECRETO si es obligatoria
 * en produccion; esa regla vive en index.js porque cargarEnv no sabe de
 * obligatoriedad condicional.
 */

import { cargarEnv } from '@goldorado/comun';

export const env = cargarEnv(
  import.meta.url,
  {
    PORT: { tipo: 'entero', defecto: 3000 },
    // Origen(es) del frontend, separados por coma. '*' = cualquiera.
    CORS_ORIGIN: { tipo: 'lista', defecto: ['http://localhost:3003'] },
    // Donde vive el frontend: destino de los redirect de OAuth y url_retorno de Wompi.
    WEB_URL: { tipo: 'texto', defecto: 'http://localhost:3003' },
    // Base publica donde el navegador ve /api (callbacks de OAuth registrados en Google/Microsoft).
    URL_PUBLICA_API: { tipo: 'texto', defecto: 'http://localhost:3003' },
    COOKIE_SECRETO: { tipo: 'texto', secreta: true, defecto: '' },
    // 'loopback' | 'true' | 'false' | numero de saltos | lista de IPs/subredes.
    TRUST_PROXY: { tipo: 'texto', defecto: 'loopback' },

    MS_AUTENTICACION_URL: { tipo: 'texto', defecto: 'localhost:50051' },
    MS_DEPORTES_URL: { tipo: 'texto', defecto: 'localhost:50052' },
    MS_APUESTAS_URL: { tipo: 'texto', defecto: 'localhost:50053' },
    MS_TRANSACCIONES_URL: { tipo: 'texto', defecto: 'localhost:50054' },
    MS_PAGOS_URL: { tipo: 'texto', defecto: 'localhost:50055' },
    MS_IMAGENES_URL: { tipo: 'texto', defecto: 'localhost:50056' },
    GRPC_TOKEN_INTERNO: { tipo: 'texto', secreta: true, defecto: '' },

    LOG_NIVEL: { tipo: 'texto', defecto: 'info' },
  },
  { nombre: 'bff' }
);
