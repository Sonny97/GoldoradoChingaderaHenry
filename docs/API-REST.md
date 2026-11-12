# Contrato REST del BFF — GolDorado

El BFF (`bff/`, puerto 3000) es **el único punto de entrada del navegador**. Expone REST
bajo `/api` y por detrás habla gRPC con los seis microservicios.

**Compatibilidad:** todas las rutas y formas JSON del monolito (`C:\developer\goldorado\server`)
se conservan **idénticas**, para que las pantallas existentes no cambien. Lo nuevo está
marcado con 🆕.

## Convenciones

- Sobre único: `{ "success": boolean, "data": any, "message": string }` — también en errores.
- Autenticación: `Authorization: Bearer <jwt>`. El BFF valida cada token con
  `ms-autenticacion.ValidarToken` (firma + sesión no revocada). Sin token o inválido → **401**
  `"Debes iniciar sesión para continuar"` / `"Tu sesión expiró, inicia sesión de nuevo"`.
- El id del usuario **sale del token**, nunca del cuerpo ni de la URL.
- Errores gRPC → HTTP: INVALID_ARGUMENT/FAILED_PRECONDITION 400 · UNAUTHENTICATED 401 ·
  PERMISSION_DENIED 403 · NOT_FOUND 404 · ALREADY_EXISTS 409 · RESOURCE_EXHAUSTED 429 ·
  UNAVAILABLE 503 · DEADLINE_EXCEEDED 504 · otros 500. El `message` es el `details` del error
  gRPC; `data` son los datos de `x-datos` (o `null`).
- **Degradación elegante**: si un servicio de datos *secundarios* no responde (cuotas,
  imágenes, nombres de torneos, datos del partido en el historial), la respuesta sale igual
  sin ese dato (`odds: []`, `crestUrl: null`...). Si falla el servicio *principal* de la
  ruta, 503.
- JSON de entrada limitado a 100 KB; archivos (multipart) a 5 MB.
- Ruta inexistente bajo `/api` → 404 JSON. JSON mal formado → 400.
- Límite de peticiones (express-rate-limit): login, registro y recuperación 10 / 15 min en
  producción (100 en desarrollo); creación de pagos 20 / 15 min.

## Formas compartidas

```jsonc
// User
{
  "id": 1, "name": "Camilo", "lastname": "Rojas", "fullName": "Camilo Rojas",
  "email": "demo@goldorado.co",
  "documentType": "CC", "documentNumber": "1012345678", "phone": "3001234567",
  "birthDate": "1996-03-11",
  "balance": 250000, "lockedBalance": 50000, "currency": "COP",   // null si ms-apuestas no responde; 0 si no tiene billetera
  "role": "cliente", "createdAt": "2026-01-10T10:00:00.000Z",
  "profileComplete": true,        // 🆕 false: entró con Google/Microsoft y le falta la ficha
  "hasPassword": true,            // 🆕 false: cuenta solo externa
  "providers": ["MICROSOFT"],     // 🆕 cuentas externas vinculadas
  "avatarUrl": "/api/imagenes/1AbC..." // 🆕 null si no tiene foto (o ms-imagenes no responde)
}

// Team
{
  "id": 1, "name": "Millonarios", "short": "MIL", "city": "Bogotá", "leagueId": 1, "crestSeed": 0,
  "colors": { "primary": "#123a8f", "secondary": "#ffffff" },
  "crestUrl": "/api/imagenes/1XyZ..."   // 🆕 escudo en Drive; null -> escudo generado por CSS
}

// League
{ "id": 1, "name": "Liga BetPlay", "country": "Colombia", "season": "2026-II", "accent": "#e7c566" }

// Odd (chip de la franja de cuotas)
{ "key": "1", "label": "Local", "value": "2.00", "decimal": 2, "oddsId": 1, "market": "1X2", "open": true }

// Match
{
  "id": 1, "leagueId": 1, "homeTeamId": 1, "awayTeamId": 2,
  "homeScore": 1, "awayScore": 0,          // null si no ha empezado
  "status": "live", "minute": 67,           // minute null si no está en vivo
  "kickoff": "2026-11-04T19:53:00.000Z", "stadium": "El Campín", "referee": "Wilmar Roldán",
  "featured": true,
  "homeTeam": Team, "awayTeam": Team, "league": League,
  "odds": [Odd]                              // [] si ms-apuestas no responde
}

// Promo
{
  "id": 1, "title": "50% descuento", "subtitle": "En tu primera recarga", "description": "...",
  "badge": "Nuevo", "ctaLabel": "Ver detalle", "accent": "gold", "featured": true,
  "expiresAt": "2027-01-15", "leagues": [{ "id": 1, "name": "Liga BetPlay" }],
  "imageUrl": null                           // 🆕
}

// Payment 🆕
{
  "reference": "GD-1-1762300000000-a1b2", "amount": 50000, "currency": "COP",
  "method": "PSE",                            // PSE | CHECKOUT
  "status": "PENDIENTE",                      // PENDIENTE | APROBADO | RECHAZADO | ANULADO | ERROR
  "statusMessage": null, "wompiTransactionId": "1234-1762300000-12345",
  "redirectUrl": "https://...",               // banco PSE o checkout de Wompi; null mientras Wompi la genera
  "credited": false, "bank": "Banco que aprueba", "paymentMethodType": "PSE",
  "createdAt": "...", "updatedAt": "..."
}
```

## Salud

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/salud` | 200 si los 6 servicios están `ok`, 503 si alguno no. `data: { api: 'ok', servicios: [{ servicio, estado, motor, baseDatos, modo, detalle, version, tiempoActivoSeg }] }`. Un servicio que no contesta aparece con `estado: 'caido'`. |

## Autenticación — `ms-autenticacion` (SQL Server)

| Método | Ruta | Auth | Cuerpo | Respuesta |
|---|---|---|---|---|
| POST | `/api/auth/login` | — | `{ username, password }` (correo **o** documento) | 200 `{ user, token }` "Bienvenido de nuevo" · 401 "Usuario o contraseña incorrectos" · 403 cuenta inactiva · 429 |
| POST | `/api/auth/register` | — | `{ name, lastname, email, password, documentType, documentNumber, phone, birthDate, terms }` | 201 `{ user, token }` "Cuenta creada correctamente" · 409 correo/documento repetido · 400 validación. El BFF además llama `ms-apuestas.AsegurarBilletera`. |
| POST | `/api/auth/logout` | opcional | — | 200 "Sesión cerrada" siempre. Si trae token, **revoca la sesión** (tabla `Sesion`). |
| POST 🆕 | `/api/auth/logout-todos` | sí | — | 200 `{ closed: n }` "Cerraste sesión en todos tus dispositivos" |
| GET | `/api/auth/me` | sí | — | 200 `User` (perfil de SQL Server + saldo de PostgreSQL + foto de Drive) |
| PATCH | `/api/auth/perfil` | sí | `{ name?, lastname?, phone? }` | 200 `User` "Perfil actualizado" |
| POST 🆕 | `/api/auth/completar-perfil` | sí | `{ name, lastname, documentType, documentNumber, phone, birthDate, terms }` | 200 `User` "Perfil completado". Llama también `AsegurarBilletera`. 409 documento repetido. |
| POST 🆕 | `/api/auth/avatar` | sí | multipart, campo `imagen` (png/jpeg/webp ≤ 5 MB) | 200 `User` con `avatarUrl` · 400 tipo/tamaño |
| DELETE 🆕 | `/api/auth/avatar` | sí | — | 200 `User` con `avatarUrl: null` |
| GET 🆕 | `/api/auth/proveedores` | — | — | 200 `[{ code: 'GOOGLE', name: 'Google', enabled: true }, { code: 'MICROSOFT', ... }]` |
| GET 🆕 | `/api/auth/oauth/:proveedor` | — | query `destino` (ruta interna, por defecto `/inicio`) | **302** a Google/Microsoft. Guarda `state`, `nonce`, `code_verifier` y `destino` en una cookie **firmada, httpOnly, SameSite=Lax, 10 min**. Proveedor no configurado → 302 a `${WEB_URL}/auth/callback#error=...` |
| GET 🆕 | `/api/auth/oauth/:proveedor/callback` | — | query `code`, `state` (o `error`) | **302** a `${WEB_URL}/auth/callback#token=<jwt>&nuevo=0|1&destino=/inicio` o `#error=<mensaje>`. Verifica `state` contra la cookie y la borra. Si el usuario es nuevo, `AsegurarBilletera`. |
| POST | `/api/auth/recuperar/buscar` | — | `{ username }` | 200 `{ userId, emailMasked, phoneMasked, hasEmail, hasSms }` · 404 |
| POST | `/api/auth/recuperar/solicitar` | — | `{ username, method: 'email'|'sms' }` | 200 `{ token, method, destinationMasked, expiresAt (epoch ms), devCode? }` · 400/404 |
| POST | `/api/auth/recuperar/verificar` | — | `{ token, code }` | 200 `{ resetToken }` "Código verificado" · 400 con `data: { tokenDead: true }` si la solicitud ya no sirve |
| POST | `/api/auth/recuperar/restablecer` | — | `{ resetToken, password }` | 200 `{ email }` "Tu contraseña fue actualizada" · 400 |

El token viaja al frontend en el **fragmento** (`#token=`) y no en la query: el fragmento no
se envía a ningún servidor ni queda en logs ni en el `Referer`.

## Catálogos y fútbol — `ms-deportes` (MySQL)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/catalogos/tipos-documento` | `[{ value: 'CC', label: 'Cédula de ciudadanía' }, ...]` (de `ms-autenticacion`, CC primero) |
| GET | `/api/catalogos/ligas` | `[League]` |
| GET | `/api/catalogos/equipos?ligaId=` | `[Team & { league: League }]` |
| GET | `/api/catalogos/equipos/:id` | `Team & { league }` · 404 "Equipo no encontrado" |
| GET 🆕 | `/api/catalogos/jugadores?equipoId=` | `[{ id, teamId, team, name, lastname, fullName, position, number, birthDate, country, active }]` |
| GET 🆕 | `/api/catalogos/estadios` | `[{ id, name, city, country, capacity }]` |
| GET 🆕 | `/api/calendario?ligaId=&jornada=` | `[{ id, number, startDate, endDate, league, season, matches: [Match] }]` |
| GET | `/api/encuentros?estado=&ligaId=&equipoId=&limite=` | `[Match]` (estado `all`/vacío = todos; un estado inválido como `esports` → `[]`) |
| GET | `/api/encuentros/destacados?limite=4` | `[Match]` |
| GET | `/api/encuentros/:id` | `Match & { stats: { possession:[l,v], shots, shotsOnTarget, fouls, corners } | null, lineup: [{ id, teamId, name, number, position, starter, goals, assists, minutes }] }` · 400 id inválido · 404 |

`Match` = partido de `ms-deportes` + `odds` de `ms-apuestas` + `crestUrl` de `ms-imagenes`
(tres servicios, una respuesta: esa es la razón de ser del BFF).

## Promociones — `ms-apuestas` (PostgreSQL)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/promociones?limite=&excluirDestacada=true` | `[Promo]` (solo vigentes) |
| GET | `/api/promociones/destacada` | `Promo` · 404 "No hay promociones disponibles" |
| GET | `/api/promociones/:id` | `Promo` · 404 "Promoción no encontrada" |

`leagues` se arma con los `idsTorneo` de PostgreSQL + los nombres de `ms-deportes`.

## Apuestas — `ms-apuestas` (PostgreSQL)

Todas con sesión.

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/api/apuestas` | `{ oddsId, amount }` | 201 `{ betId, transactionId, amount, odds, potentialWin, placedAt, matchId, selection, market, balance, lockedBalance }` "Apuesta registrada" · 400 (monto, cuota cerrada, partido terminado, límites, "Saldo insuficiente") · 403 "Completa tu perfil para apostar" |
| GET | `/api/apuestas?limite=20` | — | `[{ id, status, amount, odds, potentialWin, placedAt, selection, market, transactionId, match: { id, status, kickoff, home, away, league } }]` |
| GET | `/api/apuestas/resumen` | — | `{ total, won, lost, pending, staked, returned, roi }` |

## Billetera 🆕 — `ms-apuestas` + `ms-transacciones` (MongoDB)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/billetera` | `{ balance, lockedBalance, currency }` |
| GET | `/api/billetera/movimientos?limite=20&tipo=` | `[{ code, type, status, amount, currency, origin, reference, provider, method, createdAt, updatedAt }]` (libro de MongoDB) |

| POST 🆕 | `/api/billetera/retiros` | `{ amount, bank, accountType: 'AHORROS'|'CORRIENTE', accountNumber }` (sesión + perfil completo; no admin) | 201 `{ reference, amount, balance, lockedBalance, date }` "Retiro registrado" · 400 (monto mínimo $10.000, datos, "Saldo insuficiente"). Transferencia **simulada**. |

## Administración 🆕 — solo rol `admin` (403 "Solo un administrador puede hacer esto")

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/admin/encuentros` | — | `[Match]` (todos los estados, igual que `/api/encuentros`) |
| PATCH | `/api/admin/encuentros/:id` | `{ status, minute?, homeScore?, awayScore? }` | 200 `{ match: Match, settlement: Settlement \| null }`. Si el nuevo estado es `finished` o `canceled`, el BFF llama además `ms-apuestas.LiquidarEncuentro` y devuelve el resultado. 400/404 según ms-deportes. |
| POST | `/api/admin/encuentros/:id/liquidar` | — | 200 `Settlement` (reintento manual; idempotente) |

`Settlement` = `{ matchId, matchStatus, settled, won, lost, voided, paidOut }`.
Las apuestas liquidadas aparecen en `/api/apuestas` con `status` `GANADA` / `PERDIDA` / `ANULADA`
y el resumen (`/api/apuestas/resumen`) cuenta ganadas y rendimiento.

## Pagos con Wompi 🆕 — `ms-pagos` (Firestore)

| Método | Ruta | Auth | Cuerpo | Respuesta |
|---|---|---|---|---|
| GET | `/api/pagos/config` | — | — | `{ mode, publicKey, currency, minAmount, maxAmount, methods, suggestedAmounts, termsUrl, personalDataUrl }` (`termsUrl`/`personalDataUrl` = contratos de Wompi que el usuario debe aceptar; `''` en modo simulado) |
| GET | `/api/pagos/pse/bancos` | sí | — | `[{ code, name }]` |
| POST | `/api/pagos/pse` | sí + perfil completo | `{ amount, bankCode, personType: 0|1, documentType?, documentNumber?, acceptTerms: true, acceptPersonalData: true }` | 201 `Payment` (si `redirectUrl` es null, consultar `GET /api/pagos/:reference` cada 2 s hasta que llegue) · 400 si falta aceptar alguno de los dos contratos ("Debes aceptar el reglamento y la autorización de datos personales de Wompi") |
| POST | `/api/pagos/checkout` | sí + perfil completo | `{ amount }` | 201 `Payment` con `redirectUrl` del Web Checkout |
| GET | `/api/pagos?limite=20` | sí | — | `[Payment]` del usuario |
| GET | `/api/pagos/wompi/:idTransaccion` | sí | — | `Payment` (al volver del checkout: Wompi agrega `?id=` a la URL de retorno). Refresca contra Wompi. |
| GET | `/api/pagos/:referencia` | sí | — | `Payment` refrescado contra Wompi; si quedó APROBADO, ya viene `credited: true` · 403 si es de otro usuario · 404 |
| POST | `/api/pagos/webhook` | **firma Wompi** | evento de Wompi | **exactamente 200** `{ success: true }` si se procesó, ya estaba procesado o es de otro ambiente (Wompi trata 201/204 como fallo) · 401 si el checksum no coincide · 500 ante un error transitorio, para que Wompi reintente (+30 min, +3 h, +24 h) |

Datos del pagador (correo, nombre, teléfono, documento) salen del **perfil** del usuario;
el cuerpo solo puede cambiar tipo/número de documento (pagar con el documento del titular
de la cuenta bancaria).

URL de retorno: el BFF manda `url_retorno = ${WEB_URL}/pagos/resultado` y `ms-pagos` le agrega
`?referencia=<ref>` antes de dársela a Wompi. Wompi añade `id` y `env` con `URLSearchParams.append`
(respeta el query existente), así que el usuario vuelve a
`/pagos/resultado?referencia=<ref>&id=<idWompi>&env=test`. La página usa `referencia` (y `id`
como respaldo). En modo `simulado`: `/pagos/resultado?referencia=<ref>&simulado=1`.
La redirección es **solo informativa**: el estado real siempre se lee de la API de Wompi (llave
privada) o de un webhook con firma válida.

## Imágenes 🆕 — `ms-imagenes` (Google Drive)

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| GET | `/api/imagenes/:id` | — | los **bytes** de la imagen (streaming gRPC → HTTP). Cabeceras: `Content-Type`, `Cache-Control: public, max-age=86400, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. 404 JSON si no existe. |
| GET | `/api/imagenes?entidad=equipo&ids=1,2,3` | — | `[{ id, url, name, mimeType, size, entity, entityId, description, createdAt }]` |
| POST | `/api/imagenes` | **admin** | multipart: `imagen`, `entidad`, `idEntidad`, `descripcion?`, `reemplazar?` → 201 imagen |
| DELETE | `/api/imagenes/:id` | **admin** | 200 |

Entidades válidas: `equipo`, `jugador`, `estadio`, `torneo`, `promocion`, `usuario`.
Tipos: `image/png`, `image/jpeg`, `image/webp` (y `image/svg+xml` solo para admin).
