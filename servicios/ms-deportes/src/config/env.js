/**
 * Variables de entorno de ms-deportes, validadas UNA vez al arrancar.
 *
 * Los nombres son los de docs/CONVENCIONES.md (seccion 6) y los valores por
 * defecto coinciden con docker-compose.yml, asi que con el contenedor de MySQL
 * del monorepo basta con copiar .env.example a .env.
 *
 * MYSQL_PASSWORD no es obligatoria a proposito: el servicio debe arrancar
 * aunque no pueda entrar a la base (lo informa en Salud y en el log), igual que
 * el monolito arrancaba con la base caida. Una clave vacia termina en
 * ER_ACCESS_DENIED_ERROR con una pista clara, no en un proceso que no levanta.
 */

import { cargarEnv } from '@goldorado/comun';

export const env = cargarEnv(
  import.meta.url,
  {
    GRPC_PUERTO: { tipo: 'entero', defecto: 50052 },
    GRPC_HOST: { tipo: 'texto', defecto: '0.0.0.0' },
    GRPC_TOKEN_INTERNO: { tipo: 'texto', secreta: true, defecto: '' },
    LOG_NIVEL: { tipo: 'texto', defecto: 'info' },

    MYSQL_HOST: { tipo: 'texto', defecto: 'localhost' },
    MYSQL_PORT: { tipo: 'entero', defecto: 3306 },
    MYSQL_USER: { tipo: 'texto', defecto: 'goldorado_app' },
    MYSQL_PASSWORD: { tipo: 'texto', secreta: true, defecto: '' },
    MYSQL_DATABASE: { tipo: 'texto', defecto: 'goldorado_deportes' },
    // true para MySQL administrado en la nube (Azure, RDS...): exigen TLS.
    MYSQL_SSL: { tipo: 'booleano', defecto: false },
  },
  { nombre: 'ms-deportes' }
);
