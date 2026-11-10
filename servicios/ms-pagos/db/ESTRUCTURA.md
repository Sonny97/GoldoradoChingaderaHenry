# Estructura de Firestore — ms-pagos

Firestore es una base **documental**: no hay tablas ni esquema fijo; hay colecciones de
documentos JSON (con tipos: texto, número, booleano, fecha, arreglo, mapa) y subcolecciones
debajo de cada documento. El "esquema" vive en el código (`src/servicios/pagoServicio.js`) y
las garantías se dan con **ids deterministas**, **transacciones** (`runTransaction`) y
**reglas de seguridad** que cierran todo acceso de clientes.

## Colecciones

```
pagos/{referencia}                 un documento por recarga (id = nuestra referencia)
  └── eventos/{auto}               historial: cada transición, webhook, consulta, acreditación
eventos_wompi/{sha256(checksum)}   cuerpo crudo de cada webhook recibido (deduplicación)
```

### `pagos/{referencia}`

| Campo | Tipo | Descripción |
|---|---|---|
| `referencia` | string | `GD-<idUsuario>-<epochMs>-<4 hex>` (semillas: `GD-SEED-000x`). También es el id del documento y el `codigo` del movimiento en MongoDB y la `referencia` en `movimiento_saldo` (PostgreSQL) |
| `idUsuario` | number | `Usuario.id_usuario` de SQL Server (sin llave foránea: otra base) |
| `monto` / `montoCentavos` | number | pesos enteros / `monto × 100` (lo que se compara con `amount_in_cents` de Wompi) |
| `moneda` | string | siempre `COP` |
| `metodo` | string | `PSE` \| `CHECKOUT` |
| `estado` | string | `PENDIENTE` \| `APROBADO` \| `RECHAZADO` \| `ANULADO` \| `ERROR` |
| `mensajeEstado` | string\|null | `status_message` de Wompi o el motivo del error |
| `idTransaccionWompi` | string\|null | transacción vigente en Wompi |
| `idsTransaccionWompi` | string[] | todas las transacciones vistas con esta referencia (reintentos del checkout); consulta `array-contains` |
| `idTransaccionAprobada` | string\|null | la que se acreditó; una segunda APPROVED no se acredita |
| `aprobacionesDuplicadas` | string[] | aprobaciones extra marcadas para devolución manual |
| `urlPago` | string\|null | URL del banco (PSE) o del Web Checkout |
| `urlRedireccion` | string | `urlRetorno?referencia=<ref>` enviada a Wompi |
| `banco` | map\|null | `{ codigo, nombre }` (PSE) |
| `tipoPersona` | number\|null | 0 natural, 1 jurídica (PSE) |
| `pagador` | map | `{ email, nombreCompleto, telefono, tipoDocumento, numeroDocumento }` |
| `medioWompi` | string\|null | `payment_method_type` que reportó Wompi (`PSE`, `NEQUI`, `CARD`…) |
| `ambiente` | string | `sandbox` \| `produccion` \| `simulado` |
| `acreditado` / `acreditadoEn` | bool / timestamp | el saldo ya se sumó en ms-apuestas |
| `libroPendiente` / `libroEstado` | bool / string\|null | sincronía con el libro de ms-transacciones (MongoDB) |
| `creadoEn` / `actualizadoEn` | timestamp | |

Ejemplo (`pagos/GD-SEED-0002`):

```json
{
  "referencia": "GD-SEED-0002", "idUsuario": 2, "monto": 100000, "montoCentavos": 10000000,
  "moneda": "COP", "metodo": "PSE", "estado": "APROBADO", "mensajeEstado": null,
  "idTransaccionWompi": "12-1762400000-10002", "idsTransaccionWompi": ["12-1762400000-10002"],
  "idTransaccionAprobada": "12-1762400000-10002", "aprobacionesDuplicadas": [],
  "banco": { "codigo": "1", "nombre": "Banco que aprueba" }, "tipoPersona": 0,
  "pagador": { "email": "valentina.mesa@hotmail.com", "nombreCompleto": "Valentina Mesa",
               "telefono": "573109876123", "tipoDocumento": "CC", "numeroDocumento": "1098765432" },
  "medioWompi": "PSE", "ambiente": "sandbox", "acreditado": true, "libroPendiente": false,
  "libroEstado": "COMPLETADO", "creadoEn": "<timestamp>", "actualizadoEn": "<timestamp>"
}
```

### `pagos/{referencia}/eventos/{auto}`

`{ tipo, origen, estadoAnterior, estadoNuevo, idTransaccionWompi?, estadoWompi?, detalle?, payload?, fecha }`

- `tipo`: `CREADO`, `TRANSACCION_CREADA`, `ESTADO_WOMPI`, `ACREDITADO`, `ACREDITACION_FALLIDA`,
  `INCONSISTENTE`, `APROBACION_DUPLICADA`, `ERROR_WOMPI`, `CREACION_SIN_RESPUESTA`, `VENCIDO`.
- `origen`: `CREACION`, `CONSULTA`, `WEBHOOK`, `CONCILIACION`, `SEMILLA`.
- `payload`: JSON de la transacción de Wompi (id, referencia, centavos, estado, medio), sin
  datos personales.

```json
{ "tipo": "ESTADO_WOMPI", "origen": "WEBHOOK", "estadoAnterior": "PENDIENTE", "estadoNuevo": "APROBADO",
  "idTransaccionWompi": "12-1762400000-10002", "estadoWompi": "APPROVED",
  "payload": "{\"id\":\"12-1762400000-10002\",\"reference\":\"GD-SEED-0002\",\"amount_in_cents\":10000000,...}",
  "fecha": "<timestamp>" }
```

### `eventos_wompi/{sha256(checksum)}`

`{ evento, environment, idTransaccionWompi, referencia, estadoWompi, timestamp, cuerpo, procesado, recibidoEn, procesadoEn?, resultado? }`

El id es el SHA-256 del checksum del evento: un reintento de Wompi del **mismo** evento cae en
el mismo documento (`create()` falla con ALREADY_EXISTS) y no se procesa dos veces. Si el
procesamiento falló (`procesado: false`), el reintento sí se procesa: es idempotente.

## Índices (`firestore.indexes.json`)

| Consulta | Índice |
|---|---|
| `ListarPagos`: `idUsuario == x` orden `creadoEn desc` | `idUsuario ASC, creadoEn DESC` |
| Conciliación: `estado == PENDIENTE` y `creadoEn <= corte` orden `creadoEn` | `estado ASC, creadoEn ASC` |
| Aprobados sin acreditar: `estado == APROBADO` y `acreditado == false` | `estado ASC, acreditado ASC` |
| `collectionGroup('eventos')`: `origen == WEBHOOK` orden `fecha desc` | grupo de colecciones `origen ASC, fecha DESC` |
| `idsTransaccionWompi array-contains`, `libroPendiente == true` | automáticos de un campo |

`eventos_wompi.cuerpo` y `eventos.payload` se excluyen de la indexación (texto largo que nunca
se filtra).

## Reglas (`firestore.rules`)

`allow read, write: if false` para todo. Solo ms-pagos accede, con el Admin SDK (cuenta de
servicio), que no está sujeto a las reglas. El navegador nunca habla con Firestore.

## ¿Por qué una base documental para los pagos?

- **Un pago es un documento**: nace con los datos que había en ese momento y se completa con lo
  que responde Wompi (medio, mensaje, ids de reintentos). Los campos varían por método (PSE trae
  banco y tipo de persona; el checkout no) sin columnas nulas ni migraciones.
- **El historial cuelga del pago** (subcolección `eventos`): se lee completo con una consulta y
  crece sin tocar el documento principal; `collectionGroup` permite auditarlos todos a la vez.
- **El id es la clave de negocio** (la referencia): la idempotencia por referencia no necesita
  un índice único aparte, y `runTransaction` da lectura-modificación-escritura atómica sobre el
  estado y `acreditado` cuando la consulta del usuario y el webhook llegan a la vez.
- **Guardar evidencia cruda** (los webhooks tal como llegaron) es natural en JSON.
- Lo que Firestore no da (JOINs, SUM sobre varias colecciones) no se necesita aquí: el saldo vive
  en PostgreSQL (ms-apuestas) y el libro contable en MongoDB (ms-transacciones).
