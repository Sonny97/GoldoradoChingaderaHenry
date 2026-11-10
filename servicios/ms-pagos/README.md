# ms-pagos — Firebase (Cloud Firestore) + Wompi · gRPC :50055

Recargas de saldo con **Wompi** por dos caminos: **PSE por API** (el usuario elige su banco en
nuestra pantalla) y **Web Checkout** (página de Wompi con todos sus medios). Cuando Wompi
confirma `APPROVED`, este servicio le pide a `ms-apuestas` que acredite el saldo
(`AcreditarDeposito`, idempotente por referencia) y lleva el movimiento al libro de
`ms-transacciones` (MongoDB).

Guía de integración verificada (llaves, flujos, firmas, estados, datos de prueba):
**[docs/WOMPI.md](../../docs/WOMPI.md)**. Contrato: [`proto/pagos.proto`](../../proto/pagos.proto).

## Qué es dueño

| Colección Firestore | Contenido |
|---|---|
| `pagos/{referencia}` | cada recarga: monto, método, estado, transacciones de Wompi, acreditado |
| `pagos/{referencia}/eventos` | historial de transiciones, webhooks, consultas y acreditaciones |
| `eventos_wompi/{sha256}` | webhooks crudos (deduplicación de reintentos) |

Detalle, ejemplos e índices: [`db/ESTRUCTURA.md`](db/ESTRUCTURA.md). Consultas de sustentación:
[`db/03_consultas.js`](db/03_consultas.js).

## RPCs

| RPC | Qué hace |
|---|---|
| `Salud` | motor `Firestore`, modo `<PAGOS_ALMACEN>/<WOMPI_MODO>`, lectura mínima de Firestore |
| `ObtenerConfiguracion` | modo, llave **pública**, límites, montos sugeridos y los `permalink` de los dos contratos de Wompi (vacíos en simulado o si Wompi no responde; nunca falla) |
| `ListarBancosPse` | bancos PSE (cache 1 h) |
| `CrearPagoPse` | valida (monto entero en límites, banco, tipo de persona, pagador, **las dos casillas**) → guarda PENDIENTE → tokens de aceptación nuevos → `POST /transactions` → espera la URL del banco (~20 s) → libro PENDIENTE |
| `CrearPagoCheckout` | guarda PENDIENTE → URL firmada del Web Checkout → libro PENDIENTE |
| `ConsultarPago` | por referencia o por `id` de Wompi; dueño obligatorio (`idUsuario` 0 = sistema); si no es final, refresca contra Wompi y acredita |
| `ListarPagos` | del usuario, recientes primero (20 por defecto) |
| `ProcesarEventoWompi` | webhook: checksum (401 si no coincide + evento CRÍTICO), ambiente, deduplicación, **re-lee la transacción con la llave privada** y aplica; error transitorio → UNAVAILABLE para que Wompi reintente |

Reglas de dinero (`src/servicios/pagoServicio.js`, función `aplicarEstadoWompi`, la única que
aplica estados de Wompi):

- La transacción debe coincidir con el registro: misma referencia, `amount_in_cents` idéntico,
  `COP`. Si no → `ERROR`, no se acredita y se reporta `PAGO_MONTO_INCONSISTENTE` (CRÍTICO).
- `APROBADO` y no acreditado → `AcreditarDeposito` → `acreditado = true`. Consulta, webhook y
  conciliación pueden llegar a la vez: la transición es atómica (`runTransaction`) y
  `ms-apuestas` es idempotente por referencia, así que el saldo se suma **una vez**.
- Una segunda transacción APPROVED con la misma referencia (reintento del checkout) no se
  acredita: queda en `aprobacionesDuplicadas` y se reporta `PAGO_DUPLICADO_REVISION`.
- Libro de MongoDB y eventos de seguridad: best-effort (`libroPendiente` si falla).

**Conciliación** (cada `CONCILIACION_INTERVALO_MS`, sin solaparse): PENDIENTE con más de 2 min
→ se pregunta a Wompi (por id, o por referencia si el id no se conoce); APROBADO sin acreditar
→ reintenta; `libroPendiente` → reintenta el libro. Un PENDIENTE sin ninguna transacción en
Wompi después de 24 h pasa a `ERROR` ("venció").

## Correr

```bash
cp .env.example .env               # sin cambios: memoria + Wompi simulado
npm run dev -w @goldorado/ms-pagos # o npm start
npm test  -w @goldorado/ms-pagos   # node --test, sin red ni Firebase
```

### Modo sin nube (por defecto)

`PAGOS_ALMACEN=memoria` + `WOMPI_MODO=simulado`. Arranca con `GD-SEED-0001` (usuario 1,
$300.000, checkout/NEQUI) y `GD-SEED-0002` (usuario 2, $100.000, PSE). Bancos:
**"Banco que aprueba (simulado)"** (código 1) y **"Banco que rechaza (simulado)"** (código 2).
La URL de pago vuelve directo a `urlRetorno?referencia=<ref>&simulado=1` y la consulta resuelve
el pago con **el mismo código** de transición y acreditación de los modos reales.

### Firestore (el motor del tablero)

1. Consola de Firebase → crear proyecto → *Firestore Database* → crear (modo producción).
2. *Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada* → guardar en
   `servicios/ms-pagos/credenciales/firebase.json` (la carpeta está en `.gitignore`).
3. `.env`: `PAGOS_ALMACEN=firestore`, `FIREBASE_CREDENCIALES=credenciales/firebase.json`,
   `FIREBASE_PROJECT_ID=<id>`.
4. `npm run db:setup -w @goldorado/ms-pagos` (siembra los 2 pagos con su historial) y, una vez,
   `firebase deploy --only firestore:rules,firestore:indexes --project <id>` desde esta carpeta
   (`firebase.json` apunta a `db/`).
5. `node db/03_consultas.js` corre las consultas de sustentación.

Sin cuenta de Google Cloud: `firebase emulators:start --only firestore --project demo-goldorado`
y `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.

### Wompi sandbox

1. Crear cuenta en [comercios.wompi.co](https://comercios.wompi.co) → *Desarrolladores* →
   copiar las cuatro llaves de **pruebas** a `.env`: `WOMPI_LLAVE_PUBLICA=pub_test_…`,
   `WOMPI_LLAVE_PRIVADA=prv_test_…`, `WOMPI_SECRETO_EVENTOS=test_events_…`,
   `WOMPI_SECRETO_INTEGRIDAD=test_integrity_…` y `WOMPI_MODO=sandbox`.
2. **Webhook** (para que el pago se confirme aunque el usuario cierre la pestaña): Wompi necesita
   una URL HTTPS pública hacia el BFF. En local, con un túnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000     # o: ngrok http 3000
   ```
   y en el panel de Wompi (*Desarrolladores → URL de eventos*, ambiente de pruebas):
   `https://<subdominio-del-tunel>/api/pagos/webhook`. El BFF debe responder **exactamente 200**.
   Sin túnel todo funciona igual: la consulta al volver y la conciliación leen el estado de la API.
3. Datos de prueba del sandbox:

| Medio | Aprobada | Rechazada | Error |
|---|---|---|---|
| PSE (código de banco) | `1` "Banco que aprueba" | `2` "Banco que declina" | `3` |
| Tarjeta (checkout) | `4242 4242 4242 4242` | `4111 1111 1111 1111` | cualquier otra |
| Nequi (checkout) | `3991111111` | `3992222222` | cualquier otro |

En sandbox el banco 1 pasa a APPROVED unos 2 s después de crear la transacción, sin visitar el
banco. En producción (`WOMPI_MODO=produccion`, llaves `_prod_`) queda PENDING hasta que el
usuario termina en su banco.

## Variables

Todas en [`.env.example`](.env.example), comentadas. Secretos (`WOMPI_LLAVE_PRIVADA`,
`WOMPI_SECRETO_*`, el JSON de Firebase) nunca se escriben en el log ni salen por el contrato.

## Estructura

```
src/index.js                 arranque: env -> almacen -> pasarela -> gRPC -> conciliacion -> apagado
src/config/env.js            variables validadas
src/config/firestore.js      una conexion Admin SDK (credenciales / emulador)
src/grpc/handlers.js         RPC <-> servicio, campo por campo
src/servicios/pagoServicio.js  reglas de negocio (aplicarEstadoWompi, conciliar...)
src/servicios/estados.js     Wompi <-> GolDorado <-> libro de MongoDB
src/servicios/conciliacion.js  proceso de fondo sin solapamiento
src/repositorios/            Firestore y memoria (misma interfaz) + semilla
src/wompi/firmas.js          firma de integridad, checksum de eventos, URL del checkout (puras)
src/wompi/cliente.js         API de Wompi con fetch + AbortSignal.timeout
src/wompi/simulado.js        pasarela simulada (misma interfaz)
src/clientes/                gRPC hacia ms-apuestas y ms-transacciones
db/                          ESTRUCTURA.md, reglas, indices, semilla, consultas, setup
test/                        node --test
```
