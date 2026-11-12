/**
 * Prueba de punta a punta del BFF contra servidores gRPC FALSOS.
 *
 * fetch -> Express (app real) -> clientes gRPC reales -> red -> seis servidores
 * gRPC con datos en memoria (test/falsos.js). Se comprueban codigos HTTP y
 * FORMAS JSON de docs/API-REST.md, la agregacion entre servicios, el puente de
 * streaming de imagenes, el flujo OAuth, el webhook, la traduccion de errores
 * gRPC -> HTTP y la degradacion cuando se apaga un servicio secundario.
 *
 * Las pruebas van en orden (comparten estado: el login de una lo usan las
 * siguientes) y las que apagan servicios van al final.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { crearApp } from '../src/app.js';
import { cerrarClientes, crearClientes } from '../src/clientes.js';
import { levantarFalsos, logMudo, BYTES_ESCUDO } from './falsos.js';

const ENV = Object.freeze({
  PORT: 0,
  CORS_ORIGIN: ['http://localhost:3003'],
  WEB_URL: 'http://web.test',
  URL_PUBLICA_API: 'http://api.test',
  COOKIE_SECRETO: 'secreto-de-prueba',
  TRUST_PROXY: 'loopback',
  GRPC_TOKEN_INTERNO: '',
  NODE_ENV: 'test',
  esDesarrollo: true,
});

let falsos;
let clientes;
let servidor;
let base;
let tokenDemo;

async function pedir(ruta, { metodo = 'GET', token, cuerpo, cabeceras = {}, crudo } = {}) {
  const headers = { ...cabeceras };
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (crudo !== undefined) body = crudo;
  else if (cuerpo !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(cuerpo);
  }
  const res = await fetch(base + ruta, { method: metodo, headers, body, redirect: 'manual' });
  const tipo = res.headers.get('content-type') ?? '';
  const json = tipo.includes('application/json') ? await res.json() : null;
  return { status: res.status, json, res };
}

const login = async (username, password) =>
  pedir('/api/auth/login', { metodo: 'POST', cuerpo: { username, password } });

describe('BFF de punta a punta (servicios falsos)', () => {
  before(async () => {
    falsos = await levantarFalsos();
    clientes = crearClientes(ENV, { direcciones: falsos.direcciones });
    const app = crearApp({ env: ENV, clientes, log: logMudo });
    await new Promise((resolve) => {
      servidor = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => servidor.close(resolve));
    servidor.closeAllConnections?.();
    cerrarClientes(clientes);
    await falsos.apagar();
  });

  it('salud: los seis servicios ok -> 200', async () => {
    const { status, json } = await pedir('/api/salud');
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.api, 'ok');
    assert.equal(json.data.servicios.length, 6);
    assert.deepEqual(
      json.data.servicios.map((s) => s.servicio),
      ['ms-autenticacion', 'ms-deportes', 'ms-apuestas', 'ms-transacciones', 'ms-pagos', 'ms-imagenes']
    );
    assert.ok(json.data.servicios.every((s) => s.estado === 'ok' && s.motor && s.version === '1.0.0'));
  });

  it('login por correo: 200 { user, token } con saldo y foto; pasa IP y navegador', async () => {
    const { status, json, res } = await login('demo@goldorado.co', 'Demo1234!');
    assert.equal(status, 200);
    assert.equal(json.message, 'Bienvenido de nuevo');
    assert.ok(json.data.token);
    tokenDemo = json.data.token;
    const u = json.data.user;
    assert.equal(u.id, 1);
    assert.equal(u.fullName, 'Camilo Rojas');
    assert.equal(u.documentNumber, '1012345678');
    assert.equal(u.balance, 250000);
    assert.equal(u.lockedBalance, 50000);
    assert.equal(u.currency, 'COP');
    assert.equal(u.role, 'cliente');
    assert.equal(u.profileComplete, true);
    assert.equal(u.hasPassword, true);
    assert.deepEqual(u.providers, []);
    assert.equal(u.avatarUrl, '/api/imagenes/img-avatar-1');
    assert.ok(!Object.keys(u).some((k) => k.startsWith('_')), 'sin propiedades virtuales de proto-loader');
    const ctx = falsos.datos.registro.contextos.at(-1);
    assert.ok(ctx.ip, 'contexto.ip');
    assert.equal(ctx.userAgent, 'node');
    assert.ok(res.headers.get('x-id-solicitud'));
    assert.ok(falsos.datos.registro.idsSolicitud.has(res.headers.get('x-id-solicitud')), 'x-id-solicitud propagado');
  });

  it('login por documento y clave mala (401) y SQL inyectado (401)', async () => {
    assert.equal((await login('1012345678', 'Demo1234!')).status, 200);
    const malo = await login('demo@goldorado.co', 'otra');
    assert.equal(malo.status, 401);
    assert.deepEqual(malo.json, { success: false, data: null, message: 'Usuario o contraseña incorrectos' });
    assert.equal((await login("' OR 1=1 --", 'x')).status, 401);
    assert.equal((await login({ $ne: null }, 'x')).status, 401);
  });

  it('me: sin token 401, token falso 401, con token User', async () => {
    const sin = await pedir('/api/auth/me');
    assert.equal(sin.status, 401);
    assert.equal(sin.json.message, 'Debes iniciar sesión para continuar');
    const falso = await pedir('/api/auth/me', { token: 'inventado' });
    assert.equal(falso.status, 401);
    assert.equal(falso.json.message, 'Tu sesión expiró, inicia sesión de nuevo');
    const { status, json } = await pedir('/api/auth/me', { token: tokenDemo });
    assert.equal(status, 200);
    assert.equal(json.data.email, 'demo@goldorado.co');
    assert.equal(json.data.balance, 250000);
  });

  it('register: 201, billetera asegurada; 409 repetido; 400 con data.campos', async () => {
    const cuerpo = {
      name: 'Laura', lastname: 'Pérez', email: 'laura@test.co', password: 'Clave123!', documentType: 'CC',
      documentNumber: '55555555', phone: '3005555555', birthDate: '1995-05-05', terms: true,
    };
    const ok = await pedir('/api/auth/register', { metodo: 'POST', cuerpo });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.message, 'Cuenta creada correctamente');
    assert.equal(ok.json.data.user.balance, 0);
    assert.equal(ok.json.data.user.avatarUrl, null);
    assert.ok(falsos.datos.registro.billeterasAseguradas.includes(ok.json.data.user.id));

    const repetido = await pedir('/api/auth/register', { metodo: 'POST', cuerpo });
    assert.equal(repetido.status, 409);
    assert.equal(repetido.json.message, 'Ya existe una cuenta con ese correo');

    const invalido = await pedir('/api/auth/register', { metodo: 'POST', cuerpo: { ...cuerpo, email: 'sin-arroba' } });
    assert.equal(invalido.status, 400);
    assert.deepEqual(invalido.json.data, { campos: { email: 'Correo invalido' } });

    const sinTerminos = await pedir('/api/auth/register', { metodo: 'POST', cuerpo: { ...cuerpo, terms: false } });
    assert.equal(sinTerminos.status, 400);
  });

  it('recuperar: tokenDead viaja en data; codigo correcto da resetToken', async () => {
    const buscar = await pedir('/api/auth/recuperar/buscar', { metodo: 'POST', cuerpo: { username: 'demo@goldorado.co' } });
    assert.equal(buscar.status, 200);
    assert.deepEqual(Object.keys(buscar.json.data).sort(), ['emailMasked', 'hasEmail', 'hasSms', 'phoneMasked', 'userId']);
    const sol = await pedir('/api/auth/recuperar/solicitar', { metodo: 'POST', cuerpo: { username: 'demo@goldorado.co', method: 'email' } });
    assert.equal(sol.status, 200);
    assert.equal(sol.json.data.devCode, '482913');
    assert.equal(typeof sol.json.data.expiresAt, 'number');
    const muerto = await pedir('/api/auth/recuperar/verificar', { metodo: 'POST', cuerpo: { token: 'viejo', code: '1' } });
    assert.equal(muerto.status, 400);
    assert.deepEqual(muerto.json.data, { tokenDead: true });
    const bien = await pedir('/api/auth/recuperar/verificar', { metodo: 'POST', cuerpo: { token: 'sol-1', code: '482913' } });
    assert.equal(bien.json.data.resetToken, 'reset-1');
    const rest = await pedir('/api/auth/recuperar/restablecer', { metodo: 'POST', cuerpo: { resetToken: 'reset-1', password: 'Nueva123!' } });
    assert.equal(rest.json.data.email, 'demo@goldorado.co');
  });

  it('catalogos: tipos de documento (CC primero), ligas, equipos con escudo', async () => {
    const tipos = await pedir('/api/catalogos/tipos-documento');
    assert.deepEqual(tipos.json.data[0], { value: 'CC', label: 'Cédula de ciudadanía' });
    const ligas = await pedir('/api/catalogos/ligas');
    assert.deepEqual(ligas.json.data[0], { id: 1, name: 'Liga BetPlay', country: 'Colombia', season: '2026-II', accent: '#e7c566' });
    const equipos = await pedir('/api/catalogos/equipos?ligaId=1');
    assert.equal(equipos.json.data.length, 2);
    assert.equal(equipos.json.data[0].crestUrl, '/api/imagenes/img-escudo-1');
    assert.equal(equipos.json.data[0].league.name, 'Liga BetPlay');
    assert.equal(equipos.json.data[1].crestUrl, null);
    assert.equal((await pedir('/api/catalogos/equipos/999')).status, 404);
    assert.equal((await pedir('/api/catalogos/equipos/abc')).status, 404);
  });

  it('encuentros: Match con cuotas ordenadas y escudos', async () => {
    const { status, json } = await pedir('/api/encuentros');
    assert.equal(status, 200);
    assert.equal(json.data.length, 3);
    const m = json.data[0];
    assert.equal(m.id, 1);
    assert.equal(m.status, 'live');
    assert.equal(m.minute, 67);
    assert.equal(m.homeScore, 1);
    assert.equal(m.homeTeam.short, 'MIL');
    assert.deepEqual(m.homeTeam.colors, { primary: '#123a8f', secondary: '#ffffff' });
    assert.equal(m.homeTeam.crestUrl, '/api/imagenes/img-escudo-1');
    assert.equal(m.awayTeam.crestUrl, null);
    assert.equal(m.league.name, 'Liga BetPlay');
    assert.deepEqual(m.odds.map((o) => o.key), ['1', 'X', '2', 'GG']);
    assert.deepEqual(m.odds[0], { key: '1', label: 'Local', value: '2.00', decimal: 2, oddsId: 1, market: '1X2', open: true });
    const proximo = json.data.find((x) => x.id === 5);
    assert.equal(proximo.homeScore, null);
    assert.equal(proximo.minute, null);
    assert.equal(proximo.referee, null);
    assert.equal(json.data.find((x) => x.id === 9).odds[0].open, false);

    const esports = await pedir('/api/encuentros?estado=esports');
    assert.deepEqual(esports.json.data, []);
    const enVivo = await pedir('/api/encuentros?estado=live');
    assert.equal(enVivo.json.data.length, 1);
    const destacados = await pedir('/api/encuentros/destacados?limite=4');
    assert.deepEqual(destacados.json.data.map((x) => x.id), [1]);
  });

  it('detalle de encuentro: stats + lineup; 400 id invalido; 404 inexistente', async () => {
    const { json } = await pedir('/api/encuentros/1');
    assert.deepEqual(json.data.stats.possession, [55, 45]);
    assert.equal(json.data.lineup[0].name, 'Santiago Bermúdez');
    assert.equal(json.data.odds.length, 4);
    assert.equal((await pedir('/api/encuentros/5')).json.data.stats, null);
    assert.equal((await pedir('/api/encuentros/abc')).status, 400);
    const no = await pedir('/api/encuentros/777');
    assert.equal(no.status, 404);
    assert.equal(no.json.message, 'Partido no encontrado');
  });

  it('calendario: jornadas con partidos hidratados', async () => {
    const { json } = await pedir('/api/calendario?ligaId=1');
    assert.equal(json.data[0].number, 2);
    assert.equal(json.data[0].league.name, 'Liga BetPlay');
    assert.ok(json.data[0].matches.length >= 1);
    assert.ok(json.data[0].matches[0].odds.length > 0);
  });

  it('promociones: nombres de liga de ms-deportes e imagen', async () => {
    const { json } = await pedir('/api/promociones');
    assert.equal(json.data.length, 2);
    assert.deepEqual(json.data[0].leagues, [
      { id: 1, name: 'Liga BetPlay' }, { id: 2, name: 'Copa Libertadores' },
      { id: 3, name: 'Premier League' }, { id: 4, name: 'LaLiga' },
    ]);
    assert.equal(json.data[0].imageUrl, '/api/imagenes/img-promo-1');
    assert.equal(json.data[1].imageUrl, null);
    assert.equal(json.data[0].ctaLabel, 'Ver detalle');
    assert.equal((await pedir('/api/promociones?excluirDestacada=true')).json.data.length, 1);
    assert.equal((await pedir('/api/promociones/destacada')).json.data.id, 1);
    const no = await pedir('/api/promociones/99');
    assert.equal(no.status, 404);
    assert.equal(no.json.message, 'Promoción no encontrada');
  });

  it('apuestas: registrar, saldo insuficiente, historial hidratado y resumen', async () => {
    const sin = await pedir('/api/apuestas', { metodo: 'POST', cuerpo: { oddsId: 17, amount: 5000 } });
    assert.equal(sin.status, 401);

    const r = await pedir('/api/apuestas', { metodo: 'POST', token: tokenDemo, cuerpo: { oddsId: 17, amount: 5000 } });
    assert.equal(r.status, 201);
    assert.equal(r.json.message, 'Apuesta registrada');
    assert.equal(r.json.data.balance, 245000);
    assert.equal(r.json.data.matchId, 5);
    assert.equal(r.json.data.potentialWin, 11250);

    const cerrada = await pedir('/api/apuestas', { metodo: 'POST', token: tokenDemo, cuerpo: { oddsId: 33, amount: 5000 } });
    assert.equal(cerrada.status, 400);
    assert.equal(cerrada.json.message, 'Esta cuota está cerrada en este momento');
    const saldo = await pedir('/api/apuestas', { metodo: 'POST', token: tokenDemo, cuerpo: { oddsId: 17, amount: 99999999 } });
    assert.equal(saldo.status, 400);
    assert.equal(saldo.json.message, 'Saldo insuficiente');
    assert.equal((await pedir('/api/apuestas', { metodo: 'POST', token: tokenDemo, cuerpo: { oddsId: 'x', amount: 1 } })).status, 400);

    const h = await pedir('/api/apuestas?limite=20', { token: tokenDemo });
    assert.equal(h.status, 200);
    assert.equal(h.json.data[0].id, r.json.data.betId);
    assert.deepEqual(h.json.data[0].match, {
      id: 5, status: 'upcoming', kickoff: h.json.data[0].match.kickoff, home: 'Boca Juniors', away: 'Flamengo', league: 'Copa Libertadores',
    });
    const res = await pedir('/api/apuestas/resumen', { token: tokenDemo });
    assert.deepEqual(Object.keys(res.json.data).sort(), ['lost', 'pending', 'returned', 'roi', 'staked', 'total', 'won']);
  });

  it('perfil incompleto: 403 al apostar; completar-perfil asegura billetera', async () => {
    // Usuario 4 entra con Google: se le emite un token directo en el falso.
    const s4 = `tok-4-manual`;
    falsos.datos.sesiones.set(s4, { idUsuario: 4, revocada: false });
    const no = await pedir('/api/apuestas', { metodo: 'POST', token: s4, cuerpo: { oddsId: 1, amount: 5000 } });
    assert.equal(no.status, 403);
    assert.equal(no.json.message, 'Completa tu perfil para apostar');
    const me = await pedir('/api/auth/me', { token: s4 });
    assert.equal(me.json.data.balance, 0, 'sin billetera -> 0');
    assert.equal(me.json.data.hasPassword, false);
    assert.deepEqual(me.json.data.providers, ['GOOGLE']);
    const pago = await pedir('/api/pagos/checkout', { metodo: 'POST', token: s4, cuerpo: { amount: 20000 } });
    assert.equal(pago.status, 403);
    assert.equal(pago.json.message, 'Completa tu perfil para continuar');
    const c = await pedir('/api/auth/completar-perfil', {
      metodo: 'POST', token: s4,
      cuerpo: { name: 'Andrés', lastname: 'Gómez', documentType: 'CC', documentNumber: '80000004', phone: '3000000004', birthDate: '1990-01-01', terms: true },
    });
    assert.equal(c.status, 200);
    assert.equal(c.json.message, 'Perfil completado');
    assert.equal(c.json.data.profileComplete, true);
    assert.ok(falsos.datos.registro.billeterasAseguradas.includes(4));
  });

  it('billetera y movimientos', async () => {
    const b = await pedir('/api/billetera', { token: tokenDemo });
    assert.deepEqual(b.json.data, { balance: 245000, lockedBalance: 55000, currency: 'COP' });
    const m = await pedir('/api/billetera/movimientos?limite=20', { token: tokenDemo });
    assert.equal(m.json.data[0].code, 'GD-SEED-0001');
    assert.deepEqual(Object.keys(m.json.data[0]).sort(), ['amount', 'code', 'createdAt', 'currency', 'method', 'origin', 'provider', 'reference', 'status', 'type', 'updatedAt']);
    assert.equal(m.json.data[1].reference, null);
  });

  it('pagos: config, bancos, PSE con pagador del perfil, consulta y propiedad', async () => {
    const cfg = await pedir('/api/pagos/config');
    assert.equal(cfg.json.data.mode, 'simulado');
    assert.deepEqual(cfg.json.data.methods, ['PSE', 'CHECKOUT']);
    const bancos = await pedir('/api/pagos/pse/bancos', { token: tokenDemo });
    assert.deepEqual(bancos.json.data[0], { code: '1', name: 'Banco que aprueba' });

    const sinContratos = await pedir('/api/pagos/pse', { metodo: 'POST', token: tokenDemo, cuerpo: { amount: 50000, bankCode: '1', personType: 0 } });
    assert.equal(sinContratos.status, 400);
    assert.equal(sinContratos.json.message, 'Debes aceptar el reglamento y la autorización de datos personales de Wompi');

    const pse = await pedir('/api/pagos/pse', {
      metodo: 'POST', token: tokenDemo,
      cuerpo: { amount: 50000, bankCode: '1', personType: 0, documentNumber: '999', acceptTerms: true, acceptPersonalData: true },
    });
    assert.equal(pse.status, 201);
    const p = pse.json.data;
    assert.equal(p.method, 'PSE');
    assert.equal(p.status, 'PENDIENTE');
    assert.equal(p.credited, false);
    assert.equal(p.statusMessage, null);
    assert.match(p.redirectUrl, /^http:\/\/web\.test\/pagos\/resultado/);
    const pagador = falsos.datos.registro.pagadores.at(-1);
    assert.deepEqual(pagador, { email: 'demo@goldorado.co', nombreCompleto: 'Camilo Rojas', telefono: '3001234567', tipoDocumento: 'CC', numeroDocumento: '999' });

    const consulta = await pedir(`/api/pagos/${p.reference}`, { token: tokenDemo });
    assert.equal(consulta.json.data.reference, p.reference);
    const ajeno = await pedir('/api/pagos/GD-SEED-0002', { token: tokenDemo });
    assert.equal(ajeno.status, 403);
    const wompi = await pedir('/api/pagos/wompi/1234-1762300000-12345', { token: tokenDemo });
    assert.equal(wompi.json.data.reference, 'GD-SEED-0001');
    const lista = await pedir('/api/pagos', { token: tokenDemo });
    assert.ok(lista.json.data.some((x) => x.reference === p.reference));
    const co = await pedir('/api/pagos/checkout', { metodo: 'POST', token: tokenDemo, cuerpo: { amount: 20000 } });
    assert.equal(co.status, 201);
    assert.equal(co.json.data.redirectUrl, 'https://checkout.wompi.test/p/abc');
  });

  it('webhook: cuerpo crudo; 401 firma mala; exactamente 200 { success: true }', async () => {
    const evento = '{"event":"transaction.updated","data":{"transaction":{"id":"t1","reference":"GD-SEED-0001","status":"APPROVED"}},  "timestamp":1}';
    const malo = await pedir('/api/pagos/webhook', { metodo: 'POST', crudo: evento, cabeceras: { 'content-type': 'application/json', 'x-event-checksum': 'mala' } });
    assert.equal(malo.status, 401);
    const bueno = await pedir('/api/pagos/webhook', { metodo: 'POST', crudo: evento, cabeceras: { 'content-type': 'application/json', 'x-event-checksum': 'firma-buena' } });
    assert.equal(bueno.status, 200);
    assert.deepEqual(bueno.json, { success: true });
    assert.equal(falsos.datos.registro.eventos.at(-1).cuerpoJson, evento, 'llega byte a byte');
  });

  it('imagenes: streaming con bytes y cabeceras; 404 JSON; busqueda', async () => {
    const res = await fetch(`${base}/api/imagenes/img-escudo-1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.equal(res.headers.get('content-length'), String(BYTES_ESCUDO.length));
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400, immutable');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.equals(BYTES_ESCUDO));

    const no = await pedir('/api/imagenes/no-existe');
    assert.equal(no.status, 404);
    assert.equal(no.json.message, 'Imagen no encontrada');

    const lista = await pedir('/api/imagenes?entidad=equipo&ids=1,2,3');
    assert.equal(lista.json.data.length, 1);
    assert.deepEqual(Object.keys(lista.json.data[0]).sort(), ['createdAt', 'description', 'entity', 'entityId', 'id', 'mimeType', 'name', 'size', 'url']);
    assert.equal((await pedir('/api/imagenes?entidad=planeta')).status, 400);
  });

  it('imagenes: subir solo admin; avatar del usuario', async () => {
    const forma = () => {
      const f = new FormData();
      f.append('entidad', 'equipo');
      f.append('idEntidad', '2');
      f.append('imagen', new Blob([Buffer.from([1, 2, 3])], { type: 'image/png' }), 'nal.png');
      return f;
    };
    const cliente = await fetch(`${base}/api/imagenes`, { method: 'POST', body: forma(), headers: { authorization: `Bearer ${tokenDemo}` } });
    assert.equal(cliente.status, 403);
    const admin = (await login('admin@goldorado.co', 'Admin2026#')).json.data.token;
    const subida = await fetch(`${base}/api/imagenes`, { method: 'POST', body: forma(), headers: { authorization: `Bearer ${admin}` } });
    assert.equal(subida.status, 201);
    const img = (await subida.json()).data;
    assert.equal(img.entityId, '2');
    assert.equal(img.url, `/api/imagenes/${img.id}`);

    const av = new FormData();
    av.append('imagen', new Blob([Buffer.from([9, 9])], { type: 'image/webp' }), 'yo.webp');
    const avatar = await fetch(`${base}/api/auth/avatar`, { method: 'POST', body: av, headers: { authorization: `Bearer ${tokenDemo}` } });
    assert.equal(avatar.status, 200);
    const user = (await avatar.json()).data;
    assert.match(user.avatarUrl, /^\/api\/imagenes\/img-nueva-/);

    const gif = new FormData();
    gif.append('imagen', new Blob([Buffer.from([1])], { type: 'image/gif' }), 'x.gif');
    const malTipo = await fetch(`${base}/api/auth/avatar`, { method: 'POST', body: gif, headers: { authorization: `Bearer ${tokenDemo}` } });
    assert.equal(malTipo.status, 400);

    const grande = new FormData();
    grande.append('imagen', new Blob([Buffer.alloc(5 * 1024 * 1024 + 10)], { type: 'image/png' }), 'g.png');
    const pesada = await fetch(`${base}/api/auth/avatar`, { method: 'POST', body: grande, headers: { authorization: `Bearer ${tokenDemo}` } });
    assert.equal(pesada.status, 400);
    assert.equal((await pesada.json()).message, 'La imagen supera 5 MB');

    const borrar = await pedir('/api/auth/avatar', { metodo: 'DELETE', token: tokenDemo });
    assert.equal(borrar.json.data.avatarUrl, null);
  });

  it('OAuth: inicio 302 + cookie firmada; proveedor no configurado y desconocido', async () => {
    const inicio = await pedir('/api/auth/oauth/Google?destino=/apuestas');
    assert.equal(inicio.status, 302);
    assert.match(inicio.res.headers.get('location'), /^https:\/\/accounts\.google\.test\//);
    const cookie = inicio.res.headers.getSetCookie().find((c) => c.startsWith('gd_oauth='));
    assert.ok(cookie, 'cookie gd_oauth');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\/api\/auth\/oauth/);
    assert.match(cookie, /Max-Age=600/);
    const pedido = falsos.datos.registro.oauth;
    assert.equal(pedido.redirectUri, 'http://api.test/api/auth/oauth/google/callback');
    assert.equal(pedido.state.length, 43);

    const ms = await pedir('/api/auth/oauth/microsoft');
    assert.equal(ms.status, 302);
    assert.match(ms.res.headers.get('location'), /^http:\/\/web\.test\/auth\/callback#error=/);
    assert.equal((await pedir('/api/auth/oauth/facebook')).status, 404);
  });

  it('OAuth callback: state distinto -> #error; correcto -> #token y billetera', async () => {
    const inicio = await pedir('/api/auth/oauth/google?destino=//evil.com');
    const cookie = inicio.res.headers.getSetCookie().find((c) => c.startsWith('gd_oauth=')).split(';')[0];
    const { state } = falsos.datos.registro.oauth;

    const malo = await pedir(`/api/auth/oauth/google/callback?code=codigo-bueno&state=otro`, { cabeceras: { cookie } });
    assert.equal(malo.status, 302);
    assert.equal(
      malo.res.headers.get('location'),
      `http://web.test/auth/callback#error=${encodeURIComponent('La solicitud de inicio de sesión no es válida o venció')}`
    );
    const sinCookie = await pedir(`/api/auth/oauth/google/callback?code=codigo-bueno&state=${state}`);
    assert.match(sinCookie.res.headers.get('location'), /#error=/);

    const bueno = await pedir(`/api/auth/oauth/google/callback?code=codigo-bueno&state=${state}`, { cabeceras: { cookie } });
    assert.equal(bueno.status, 302);
    const destino = new URL(bueno.res.headers.get('location'));
    assert.equal(destino.origin + destino.pathname, 'http://web.test/auth/callback');
    const frag = new URLSearchParams(destino.hash.slice(1));
    assert.match(frag.get('token'), /^tok-4-/);
    assert.equal(frag.get('nuevo'), '1');
    assert.equal(frag.get('destino'), '/inicio', 'un destino externo se reemplaza');
    assert.ok(bueno.res.headers.getSetCookie().some((c) => c.startsWith('gd_oauth=;')), 'borra la cookie');
    assert.equal(falsos.datos.registro.billeterasAseguradas.at(-1), 4);

    const cancelado = await pedir('/api/auth/oauth/google/callback?error=access_denied');
    assert.match(decodeURIComponent(cancelado.res.headers.get('location')), /#error=Cancelaste/);
  });

  it('errores genericos: 404 JSON bajo /api y JSON mal formado 400', async () => {
    const no = await pedir('/api/no-existe');
    assert.equal(no.status, 404);
    assert.equal(no.json.success, false);
    assert.equal(no.json.message, 'Ruta no encontrada: GET /api/no-existe');
    const roto = await pedir('/api/auth/login', { metodo: 'POST', crudo: '{"username":', cabeceras: { 'content-type': 'application/json' } });
    assert.equal(roto.status, 400);
    assert.equal(roto.json.message, 'El cuerpo de la petición no es un JSON válido');
  });

  it('logout revoca la sesion; logout-todos cierra las demas', async () => {
    const otro = (await login('demo@goldorado.co', 'Demo1234!')).json.data.token;
    const salir = await pedir('/api/auth/logout', { metodo: 'POST', token: otro });
    assert.deepEqual(salir.json, { success: true, data: null, message: 'Sesión cerrada' });
    assert.equal((await pedir('/api/auth/me', { token: otro })).status, 401);
    assert.equal((await pedir('/api/auth/logout', { metodo: 'POST' })).status, 200);

    const a = (await login('valentina.mesa@hotmail.com', 'Vale2024*')).json.data.token;
    const b = (await login('valentina.mesa@hotmail.com', 'Vale2024*')).json.data.token;
    const todos = await pedir('/api/auth/logout-todos', { metodo: 'POST', token: a });
    assert.equal(todos.json.data.closed, 2);
    assert.equal((await pedir('/api/auth/me', { token: b })).status, 401);
  });

  it('admin: 401 sin sesion, 403 para un cliente; lista con todos los estados', async () => {
    assert.equal((await pedir('/api/admin/encuentros')).status, 401);
    const cliente = await pedir('/api/admin/encuentros', { token: tokenDemo });
    assert.equal(cliente.status, 403);
    assert.equal(cliente.json.message, 'Solo un administrador puede hacer esto');
    assert.equal((await pedir('/api/admin/encuentros/1/liquidar', { metodo: 'POST', token: tokenDemo })).status, 403);

    const admin = (await login('admin@goldorado.co', 'Admin2026#')).json.data.token;
    const lista = await pedir('/api/admin/encuentros', { token: admin });
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.json.data.map((m) => m.status).sort(), ['finished', 'live', 'upcoming']);
    assert.ok(lista.json.data.find((m) => m.id === 1).odds.length > 0);
  });

  it('admin: PATCH valida, actualiza en vivo sin liquidar y finished liquida', async () => {
    const admin = (await login('admin@goldorado.co', 'Admin2026#')).json.data.token;
    const malo = await pedir('/api/admin/encuentros/1', { metodo: 'PATCH', token: admin, cuerpo: { status: 'jugando' } });
    assert.equal(malo.status, 400);
    assert.equal((await pedir('/api/admin/encuentros/1', { metodo: 'PATCH', token: admin, cuerpo: { status: 'live', minute: -3 } })).status, 400);
    assert.equal((await pedir('/api/admin/encuentros/999', { metodo: 'PATCH', token: admin, cuerpo: { status: 'live' } })).status, 404);

    const vivo = await pedir('/api/admin/encuentros/1', { metodo: 'PATCH', token: admin, cuerpo: { status: 'live', minute: 80, homeScore: 2, awayScore: 1 } });
    assert.equal(vivo.status, 200);
    assert.equal(vivo.json.data.settlement, null);
    assert.equal(vivo.json.data.match.minute, 80);
    assert.equal(vivo.json.data.match.homeScore, 2);

    const antes = (await pedir('/api/billetera', { token: tokenDemo })).json.data;
    const fin = await pedir('/api/admin/encuentros/1', { metodo: 'PATCH', token: admin, cuerpo: { status: 'finished', homeScore: 2, awayScore: 1 } });
    assert.equal(fin.status, 200);
    assert.equal(fin.json.data.match.status, 'finished');
    assert.ok(fin.json.data.match.homeTeam.crestUrl, 'match hidratado con escudos');
    assert.deepEqual(fin.json.data.settlement, { matchId: 1, matchStatus: 'finished', settled: 1, won: 1, lost: 0, voided: 0, paidOut: 100000 });
    const despues = (await pedir('/api/billetera', { token: tokenDemo })).json.data;
    assert.equal(despues.balance, antes.balance + 100000);
    assert.equal(despues.lockedBalance, antes.lockedBalance - 50000);

    // Idempotente: liquidar otra vez no toca nada.
    const otra = await pedir('/api/admin/encuentros/1/liquidar', { metodo: 'POST', token: admin });
    assert.equal(otra.status, 200);
    assert.equal(otra.json.data.settled, 0);
  });

  it('admin: si la liquidacion falla el partido queda guardado y se puede reintentar', async () => {
    const admin = (await login('admin@goldorado.co', 'Admin2026#')).json.data.token;
    falsos.datos.registro.fallarLiquidacion = true;
    const r = await pedir('/api/admin/encuentros/5', { metodo: 'PATCH', token: admin, cuerpo: { status: 'canceled' } });
    falsos.datos.registro.fallarLiquidacion = false;
    assert.equal(r.status, 200);
    assert.equal(r.json.data.match.status, 'canceled');
    assert.equal(r.json.data.settlement, null);
    assert.match(r.json.message, /Reintenta la liquidación/);

    const reintento = await pedir('/api/admin/encuentros/5/liquidar', { metodo: 'POST', token: admin });
    assert.equal(reintento.status, 200);
    assert.deepEqual(reintento.json.data, { matchId: 5, matchStatus: 'canceled', settled: 1, won: 0, lost: 0, voided: 1, paidOut: 5000 });
    assert.equal(falsos.datos.apuestas.find((a) => a.idEncuentro === 5).estado, 'ANULADA');
  });

  it('retiros: 201 descuenta saldo; 400 por monto y cuenta; 403 admin', async () => {
    const cuerpo = { amount: 10000, bank: 'Bancolombia', accountType: 'AHORROS', accountNumber: '12345678901' };
    const antes = (await pedir('/api/billetera', { token: tokenDemo })).json.data;
    const r = await pedir('/api/billetera/retiros', { metodo: 'POST', token: tokenDemo, cuerpo });
    assert.equal(r.status, 201);
    assert.equal(r.json.message, 'Retiro registrado');
    assert.deepEqual(Object.keys(r.json.data).sort(), ['amount', 'balance', 'date', 'lockedBalance', 'reference']);
    assert.match(r.json.data.reference, /^RET-1-/);
    assert.equal(r.json.data.balance, antes.balance - 10000);
    assert.deepEqual(falsos.datos.registro.retiros.at(-1), { idUsuario: 1, monto: 10000, banco: 'Bancolombia', tipoCuenta: 'AHORROS', numeroCuenta: '12345678901' });

    const poco = await pedir('/api/billetera/retiros', { metodo: 'POST', token: tokenDemo, cuerpo: { ...cuerpo, amount: 5000 } });
    assert.equal(poco.status, 400);
    assert.equal(poco.json.message, 'El monto mínimo de retiro es $10.000');
    const cuenta = await pedir('/api/billetera/retiros', { metodo: 'POST', token: tokenDemo, cuerpo: { ...cuerpo, accountNumber: '12ab' } });
    assert.equal(cuenta.status, 400);
    const saldo = await pedir('/api/billetera/retiros', { metodo: 'POST', token: tokenDemo, cuerpo: { ...cuerpo, amount: 99999999 } });
    assert.equal(saldo.status, 400);
    assert.equal(saldo.json.message, 'Saldo insuficiente');

    const admin = (await login('admin@goldorado.co', 'Admin2026#')).json.data.token;
    const deAdmin = await pedir('/api/billetera/retiros', { metodo: 'POST', token: admin, cuerpo });
    assert.equal(deAdmin.status, 403);
    assert.equal(deAdmin.json.message, 'Las cuentas de administrador no pueden retirar');
    assert.equal((await pedir('/api/billetera/retiros', { metodo: 'POST', cuerpo })).status, 401);
  });

  it('degradacion: sin ms-apuestas ni ms-imagenes los partidos salen sin cuotas ni escudos', async () => {
    await falsos.detener('apuestas');
    await falsos.detener('imagenes');

    const { status, json } = await pedir('/api/encuentros');
    assert.equal(status, 200);
    assert.ok(json.data.length > 0);
    assert.ok(json.data.every((m) => m.odds.length === 0 && m.homeTeam.crestUrl === null));

    const me = await pedir('/api/auth/me', { token: tokenDemo });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.balance, null);
    assert.equal(me.json.data.currency, null);
    assert.equal(me.json.data.avatarUrl, null);

    const promos = await pedir('/api/promociones/destacada');
    assert.equal(promos.status, 503, 'ms-apuestas es el principal de promociones');
    assert.match(promos.json.message, /ms-apuestas/);

    const imagen = await pedir('/api/imagenes/img-escudo-1');
    assert.equal(imagen.status, 503);

    const salud = await pedir('/api/salud');
    assert.equal(salud.status, 503);
    const caidos = salud.json.data.servicios.filter((s) => s.estado === 'caido').map((s) => s.servicio);
    assert.deepEqual(caidos, ['ms-apuestas', 'ms-imagenes']);
  });

  it('servicio principal caido -> 503 con el nombre del servicio', async () => {
    await falsos.detener('deportes');
    const r = await pedir('/api/encuentros');
    assert.equal(r.status, 503);
    assert.equal(r.json.success, false);
    assert.equal(r.json.message, 'El servicio ms-deportes no está disponible en este momento');

    await falsos.detener('autenticacion');
    const me = await pedir('/api/auth/me', { token: tokenDemo });
    assert.equal(me.status, 503);
    assert.equal(me.json.message, 'No pudimos verificar tu sesión. Intenta de nuevo.');
    const salir = await pedir('/api/auth/logout', { metodo: 'POST', token: tokenDemo });
    assert.equal(salir.status, 200, 'logout responde 200 aunque ms-autenticacion este caido');
  });
});

describe('BFF con ms-deportes caido (datos secundarios de otras rutas)', () => {
  let f;
  let c;
  let s;
  let url;

  before(async () => {
    f = await levantarFalsos();
    c = crearClientes(ENV, { direcciones: f.direcciones });
    const app = crearApp({ env: ENV, clientes: c, log: logMudo });
    await new Promise((resolve) => {
      s = app.listen(0, '127.0.0.1', resolve);
    });
    url = `http://127.0.0.1:${s.address().port}`;
    await f.detener('deportes');
  });

  after(async () => {
    await new Promise((resolve) => s.close(resolve));
    s.closeAllConnections?.();
    cerrarClientes(c);
    await f.apagar();
  });

  it('historial de apuestas con match en null y promociones sin nombres de liga', async () => {
    const entrada = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'demo@goldorado.co', password: 'Demo1234!' }),
    });
    const { token } = (await entrada.json()).data;

    const h = await fetch(`${url}/api/apuestas`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(h.status, 200);
    const [apuesta] = (await h.json()).data;
    assert.equal(apuesta.amount, 50000);
    assert.deepEqual(apuesta.match, { id: 1, status: null, kickoff: null, home: null, away: null, league: null });

    const p = await fetch(`${url}/api/promociones`);
    assert.equal(p.status, 200);
    const [promo] = (await p.json()).data;
    assert.deepEqual(promo.leagues[0], { id: 1, name: null });
    assert.equal(promo.imageUrl, '/api/imagenes/img-promo-1');
  });
});
