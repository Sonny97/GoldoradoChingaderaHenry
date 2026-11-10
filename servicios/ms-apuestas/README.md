# ms-apuestas · PostgreSQL (Azure) · gRPC :50053

El **API del negocio**: mercados, cuotas que publica Goldorado, reglas de monto,
apuestas, la billetera de cada cliente con su diario y las promociones. Contrato:
[`proto/apuestas.proto`](../../proto/apuestas.proto).

En producción la base vive en **Azure Database for PostgreSQL – Flexible Server**; en
local es un PostgreSQL normal. El código es el mismo: solo cambia el `.env` (`PG_SSL=true`).

## De qué es dueño

| Tabla | Qué guarda |
|---|---|
| `tipo_mercado`, `opcion_mercado`, `regla_apuesta` | catálogo de mercados (1X2, AMBOS_ANOTAN, OVER_UNDER), sus opciones (chips 1/X/2/GG…) y los límites de monto |
| `cuota_oferta` | la cuota de cada opción por encuentro (`ABIERTO`/`SUSPENDIDO`/`CERRADO`) |
| `cuenta_saldo` | la billetera: disponible y bloqueado (comprometido en apuestas pendientes) |
| `apuesta` | cada apuesta con su `cuota_fijada` (snapshot) y `ganancia_potencial` **GENERATED … STORED** |
| `movimiento_saldo` | diario de la billetera; `referencia` UNIQUE = clave de idempotencia |
| `promocion`, `promocion_torneo` | promociones y los torneos a los que aplican |
| `evento_salida` | **bandeja de salida (outbox)** hacia el libro contable de MongoDB |

Referencias externas (ids sin llave foránea, no puede haberla entre motores):
`cuenta_saldo.id_usuario`/`apuesta.id_usuario` → usuario de SQL Server,
`cuota_oferta.id_encuentro` y `promocion_torneo.id_torneo` → MySQL,
`apuesta.id_transaccion` (UUID) → `transacciones.codigo` de MongoDB.

## RPCs

| RPC | Qué hace | Fallos (mensaje para el usuario) |
|---|---|---|
| `CuotasPorEncuentros` | cuotas de esos encuentros, por encuentro y `orden` (lista vacía → respuesta vacía) | — |
| `RegistrarApuesta` | port exacto del monolito (mismos mensajes y orden) + estado del partido por gRPC a ms-deportes | INVALID_ARGUMENT `Ingresa un monto válido` / `El monto debe ser un valor entero en pesos` / `Selecciona una cuota para apostar`; NOT_FOUND `La cuota seleccionada no existe`; FAILED_PRECONDITION `Este partido ya terminó` / `Este partido fue cancelado` / `Esta cuota está cerrada en este momento` / `Este mercado no tiene reglas de apuesta configuradas` / `El monto mínimo…` / `El monto máximo…` / `Saldo insuficiente`; UNAVAILABLE `No pudimos verificar el estado del partido. Intenta de nuevo.` |
| `ListarApuestas` | historial, 20 por defecto (tope 100), la más reciente primero | — |
| `ResumenApuestas` | panel "Tu semana" (con la guarda de división por cero del rendimiento) | — |
| `AsegurarBilletera` | crea la billetera en 0 si no existe (idempotente) | — |
| `ObtenerBilletera` | saldo disponible / bloqueado | NOT_FOUND `La cuenta no tiene billetera` |
| `AcreditarDeposito` | lo llama ms-pagos cuando Wompi aprueba; **idempotente por `referencia`** (`aplicado=false` en un reintento) | INVALID_ARGUMENT (monto, referencia); ALREADY_EXISTS si la referencia es de otro usuario |
| `ListarPromociones` | solo vigentes (`fecha_expira >= CURRENT_DATE`), `limite` opcional, `excluirDestacada` | — |
| `PromocionDestacada` | la del banner; si ninguna está marcada, la primera vigente | NOT_FOUND `No hay promociones disponibles` |
| `ObtenerPromocion` | detalle por id | NOT_FOUND `Promoción no encontrada` |
| `Salud` | `SELECT 1`; motor PostgreSQL, modo `azure` (PG_SSL) o `local` | nunca falla: `estado: 'error'` + `detalle` |

## Cómo se registra una apuesta

1. Validaciones sin tocar dinero (monto, cuota, **estado del partido preguntándole a
   ms-deportes**, cuota abierta, regla, mínimo y máximo). Si ms-deportes no responde, la
   apuesta **no** se acepta (falla cerrado).
2. **Una** transacción de PostgreSQL:
   `INSERT cuenta_saldo … ON CONFLICT DO NOTHING` (creación perezosa) →
   `UPDATE cuenta_saldo … WHERE saldo_disponible >= $monto` (**la condición dentro del
   UPDATE**: dos peticiones simultáneas no pueden dejar el saldo negativo; 0 filas =
   `Saldo insuficiente`) → `INSERT apuesta` → `INSERT movimiento_saldo` → `INSERT evento_salida`.
3. El **relevo** (`src/servicios/relevoSalida.js`) toma cada `OUTBOX_INTERVALO_MS` los
   eventos pendientes con `FOR UPDATE SKIP LOCKED`, los envía a
   `ms-transacciones.RegistrarTransaccion` (idempotente por `codigo`) y los marca
   enviados. Si Mongo está caído, la apuesta ya quedó registrada y el libro se pone al día
   cuando vuelva; el log avisa **una** vez, no cada 3 segundos.

## Correrlo en local

```bash
# 1. PostgreSQL (docker compose lo publica en el 5433)
docker compose up -d postgres

# 2. Variables
cp servicios/ms-apuestas/.env.example servicios/ms-apuestas/.env

# 3. Base, esquema y datos semilla (re-ejecutable)
npm run db:setup -w @goldorado/ms-apuestas

# 4. Servicio
npm run dev -w @goldorado/ms-apuestas

# Pruebas (sin base ni red externa)
npm test -w @goldorado/ms-apuestas
```

El servicio **arranca aunque PostgreSQL esté caído**: lo dice en el log (con una pista
según el error: base inexistente, clave, firewall…) y en `Salud`, y el pool reintenta en
cada consulta.

Detalle de tipos de `pg`: `NUMERIC` llega como texto y se convierte con `aNumero()`;
`TIMESTAMPTZ` llega como `Date` y sale en ISO UTC; **`DATE` se deja como texto
`YYYY-MM-DD`** (`src/config/db.js`), porque el parser por defecto lo convierte en
medianoche local y, según la zona horaria de la máquina, la promo "vencería" un día antes.

## Azure Database for PostgreSQL – Flexible Server

```bash
az group create --name rg-goldorado --location eastus2

az postgres flexible-server create \
  --resource-group rg-goldorado --name goldorado-pg --location eastus2 \
  --admin-user goldorado_admin --admin-password '<clave-segura>' \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 \
  --public-access <TU_IP_PUBLICA>

# Regla de firewall adicional (otra IP, p. ej. la del equipo de un compañero)
az postgres flexible-server firewall-rule create \
  --resource-group rg-goldorado --name goldorado-pg \
  --rule-name casa-camilo --start-ip-address <IP> --end-ip-address <IP>

# La base (npm run db:setup también la crea si el usuario tiene CREATEDB)
az postgres flexible-server db create \
  --resource-group rg-goldorado --server-name goldorado-pg --database-name goldorado_apuestas
```

`.env` para Azure:

```ini
PG_HOST=goldorado-pg.postgres.database.azure.com
PG_PORT=5432
PG_USER=goldorado_admin
PG_PASSWORD=<clave-segura>
PG_DATABASE=goldorado_apuestas
PG_SSL=true
PG_SSL_VERIFICAR=true
```

Cadena de conexión equivalente (psql, DBeaver, Azure Data Studio):

```
postgresql://goldorado_admin:<clave>@goldorado-pg.postgres.database.azure.com:5432/goldorado_apuestas?sslmode=require
```

Notas:

- **TLS es obligatorio** en Azure (`PG_SSL=true`). Con `PG_SSL_VERIFICAR=true` Node valida
  la cadena del servidor contra sus CA (DigiCert / Microsoft, incluidas en Node). Si una red
  intermedia rompe la validación (`unable to get local issuer certificate`), `false` sigue
  cifrando sin validar: aceptable en clase, no en producción.
- **Firewall**: sin una regla para tu IP la conexión se queda esperando hasta el
  `connectionTimeoutMillis` (5 s). Si el servicio corre en Azure (App Service, Container
  Apps), habilita "Allow public access from any Azure service" o usa red privada.
- El administrador del Flexible Server **no es superusuario** (rol `azure_pg_admin`): este
  esquema no usa extensiones (`gen_random_uuid()` es nativo desde PostgreSQL 13) ni
  `DROP DATABASE`; `01_esquema.sql` borra y recrea solo sus tablas.
- El tier Burstable B1ms admite pocas conexiones: el pool es **uno por proceso**
  (`PG_POOL_MAX=10`), con `keepAlive` porque el gateway corta conexiones inactivas.

## Consultas de sustentación

`db/03_consultas.sql` (corre de punta a punta sin modificar datos):
verificación del esquema (`pg_constraint` + `pg_get_constraintdef`, índices, columnas
IDENTITY/GENERATED), estado de cuenta con saldo acumulado por función de ventana,
apuestas con contexto, resumen con `FILTER (WHERE …)`, cuota más alta por partido
(`row_number()` y `DISTINCT ON`), `LEFT JOIN LATERAL` (= `OUTER APPLY`), una apuesta
completa paso a paso con `ROLLBACK`, la bandeja de salida con `FOR UPDATE SKIP LOCKED`,
consultas JSONB (`->>`, `@>`, `?`, `jsonb_pretty`), idempotencia del depósito
(`ON CONFLICT DO NOTHING` y el 23505), y las violaciones con su SQLSTATE
(23514, 23503, 23505, 428C9), más promociones vigentes con `array_agg` de torneos.

## Archivos

```
src/index.js                    arranque: env -> gRPC -> base (no bloqueante) -> relevo -> apagado
src/config/env.js | db.js       variables validadas | UN pool + enTransaccion() + tipos
src/grpc/handlers.js            traduce request <-> servicios, campo por campo
src/servicios/                  reglas: apuestas, billetera, promociones, relevoSalida (outbox)
src/repositorios/               TODO el SQL, parametrizado ($1, $2…)
src/clientes/index.js           ms-deportes (estado del partido) y ms-transacciones (libro)
db/01_esquema.sql | 02_datos.sql | 03_consultas.sql | setup.js
test/                           node --test con repos y servicios falsos
```
