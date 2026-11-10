/**
 * Servidores gRPC FALSOS de los seis microservicios, para las pruebas del BFF.
 *
 * Son servidores gRPC de verdad (crearServidorGrpc de @goldorado/comun) en
 * puertos aleatorios, con datos en memoria que imitan la semilla compartida de
 * docs/CONVENCIONES.md (seccion 5). Asi la prueba ejercita el camino completo:
 * fetch -> Express -> cliente gRPC real -> red -> servidor -> error/metadatos.
 *
 * Este archivo esta en test/ y `node --test` lo ejecuta como si fuera una
 * prueba: por eso solo EXPORTA funciones y no hace nada al importarse.
 */

import { createHash } from 'node:crypto';

import {
  crearServidorGrpc,
  invalido,
  noAutenticado,
  noEncontrado,
  precondicion,
  sinPermiso,
  yaExiste,
} from '@goldorado/comun';
import { implementacionParcial, puertoLibre } from '@goldorado/comun/pruebas';

export const logMudo = { info() {}, aviso() {}, error() {}, debug() {} };

/** Bytes de la imagen de prueba: 200 KB para que viaje en varios trozos. */
export const BYTES_ESCUDO = Buffer.alloc(200 * 1024, 7);
const TROZO = 64 * 1024;

const salud = (servicio, motor) => async () => ({
  servicio,
  estado: 'ok',
  motor,
  baseDatos: 'prueba',
  detalle: '',
  version: '1.0.0',
  tiempoActivoSeg: 12.5,
  modo: 'memoria',
});

function datosSemilla() {
  const usuarios = new Map([
    [1, { id: 1, email: 'demo@goldorado.co', clave: 'Demo1234!', nombres: 'Camilo', apellidos: 'Rojas', tipoDocumento: 'CC', numeroDocumento: '1012345678', telefono: '3001234567', fechaNacimiento: '1996-03-11', rol: 'cliente', perfilCompleto: true, tienePassword: true, proveedores: [] }],
    [2, { id: 2, email: 'valentina.mesa@hotmail.com', clave: 'Vale2024*', nombres: 'Valentina', apellidos: 'Mesa', tipoDocumento: 'CC', numeroDocumento: '1098765432', telefono: '3109876123', fechaNacimiento: '1999-07-24', rol: 'cliente', perfilCompleto: true, tienePassword: true, proveedores: ['MICROSOFT'] }],
    [3, { id: 3, email: 'admin@goldorado.co', clave: 'Admin2026#', nombres: 'Admin', apellidos: 'GolDorado', rol: 'admin', perfilCompleto: false, tienePassword: true, proveedores: [] }],
    [4, { id: 4, email: 'andres.gomez.demo@gmail.com', clave: null, nombres: '', apellidos: '', rol: 'cliente', perfilCompleto: false, tienePassword: false, proveedores: ['GOOGLE'] }],
  ]);

  const torneos = [
    { id: 1, nombre: 'Liga BetPlay', pais: 'Colombia', temporada: '2026-II', acento: '#e7c566' },
    { id: 2, nombre: 'Copa Libertadores', pais: 'CONMEBOL', temporada: '2026', acento: '#3b82f6' },
    { id: 3, nombre: 'Premier League', pais: 'Inglaterra', temporada: '2026-27', acento: '#a78bfa' },
    { id: 4, nombre: 'LaLiga', pais: 'España', temporada: '2026-27', acento: '#fb7185' },
  ];
  const equipo = (id, nombre, codigoCorto, ciudad, idTorneo, primario) => ({
    id, nombre, codigoCorto, ciudad, idTorneo, crestSeed: id % 3, colores: { primario, secundario: '#ffffff' }, fundacion: '1946-06-18',
  });
  const equipos = [
    equipo(1, 'Millonarios', 'MIL', 'Bogotá', 1, '#123a8f'),
    equipo(2, 'Atlético Nacional', 'NAL', 'Medellín', 1, '#0b7a3b'),
    equipo(5, 'Boca Juniors', 'BOC', 'Buenos Aires', 2, '#0a2a6b'),
    equipo(6, 'Flamengo', 'FLA', 'Río de Janeiro', 2, '#c8102e'),
  ];
  const eq = (id) => equipos.find((e) => e.id === id);
  const ahora = Date.now();
  const encuentros = [
    { id: 1, idTorneo: 1, estado: 'live', minuto: 67, fechaHora: new Date(ahora - 67 * 60000).toISOString(), estadio: 'El Campín', arbitro: 'Wilmar Roldán', destacado: true, local: eq(1), visitante: eq(2), golesLocal: 1, golesVisitante: 0, torneo: torneos[0], numeroJornada: 2 },
    { id: 5, idTorneo: 2, estado: 'upcoming', fechaHora: new Date(ahora + 86400000).toISOString(), estadio: 'La Bombonera', destacado: false, local: eq(5), visitante: eq(6), torneo: torneos[1], numeroJornada: 2 },
    { id: 9, idTorneo: 1, estado: 'finished', fechaHora: new Date(ahora - 3 * 86400000).toISOString(), estadio: 'Atanasio Girardot', destacado: false, local: eq(2), visitante: eq(1), golesLocal: 2, golesVisitante: 2, torneo: torneos[0], numeroJornada: 1 },
  ];

  const cuota = (idCuota, idEncuentro, codigoCorto, seleccion, valor, orden, estado = 'ABIERTO', mercado = '1X2') => ({
    idCuota, idEncuentro, codigoCorto, seleccion, valor, mercado, estado, orden,
  });
  const cuotas = [
    // Desordenadas a proposito: el BFF debe ordenarlas por `orden`.
    cuota(2, 1, 'X', 'Empate', 3.1, 2),
    cuota(1, 1, '1', 'Local', 2, 1),
    cuota(4, 1, 'GG', 'Ambos', 1.75, 4, 'ABIERTO', 'AMBOS_ANOTAN'),
    cuota(3, 1, '2', 'Visita', 3.6, 3),
    cuota(17, 5, '1', 'Local', 2.25, 1),
    cuota(18, 5, 'X', 'Empate', 3.2, 2),
    cuota(19, 5, '2', 'Visita', 3.05, 3),
    cuota(33, 9, '1', 'Local', 2.4, 1, 'CERRADO'),
  ];

  return {
    usuarios,
    sesiones: new Map(),
    siguienteUsuario: 5,
    torneos,
    equipos,
    encuentros,
    cuotas,
    billeteras: new Map([
      [1, { idUsuario: 1, saldoDisponible: 250000, saldoBloqueado: 50000, moneda: 'COP' }],
      [2, { idUsuario: 2, saldoDisponible: 84500, saldoBloqueado: 15500, moneda: 'COP' }],
    ]),
    apuestas: [
      { id: 1, idUsuario: 1, estado: 'PENDIENTE', monto: 50000, cuota: 2, gananciaPotencial: 100000, fecha: new Date(ahora - 3600000).toISOString(), seleccion: 'Local', mercado: '1X2', idEncuentro: 1, idTransaccion: 'b3a1c0de-0001-4a00-9000-000000000001' },
    ],
    promociones: [
      { id: 1, titulo: '50% descuento', subtitulo: 'En tu primera recarga', descripcion: 'Recarga y recibe el doble.', badge: 'Nuevo', ctaLabel: 'Ver detalle', acento: 'gold', destacada: true, fechaExpira: '2027-01-15', idsTorneo: [1, 2, 3, 4] },
      { id: 2, titulo: 'Cuota mejorada', subtitulo: 'Clásico del fin de semana', descripcion: 'Cuota x1.2.', badge: 'Hot', ctaLabel: 'Apostar', acento: 'emerald', destacada: false, fechaExpira: '2027-02-01', idsTorneo: [1, 4] },
    ],
    transacciones: [
      { codigo: 'GD-SEED-0001', idUsuario: 1, tipo: 'DEPOSITO', estado: 'COMPLETADO', monto: 300000, moneda: 'COP', origen: 'ms-pagos', referenciaExterna: '1234-1762300000-12345', proveedor: 'Wompi', metodo: 'NEQUI', creadoEn: '2026-11-01T10:00:00.000Z', actualizadoEn: '2026-11-01T10:01:00.000Z', historial: [] },
      { codigo: 'b3a1c0de-0001-4a00-9000-000000000001', idUsuario: 1, tipo: 'APUESTA', estado: 'COMPLETADO', monto: 50000, moneda: 'COP', origen: 'ms-apuestas', creadoEn: '2026-11-02T10:00:00.000Z', actualizadoEn: '2026-11-02T10:00:00.000Z', historial: [] },
    ],
    pagos: new Map([
      ['GD-SEED-0001', { referencia: 'GD-SEED-0001', idUsuario: 1, monto: 300000, moneda: 'COP', metodo: 'CHECKOUT', estado: 'APROBADO', idTransaccionWompi: '1234-1762300000-12345', acreditado: true, creadoEn: '2026-11-01T10:00:00.000Z', actualizadoEn: '2026-11-01T10:01:00.000Z', medioWompi: 'NEQUI' }],
      ['GD-SEED-0002', { referencia: 'GD-SEED-0002', idUsuario: 2, monto: 100000, moneda: 'COP', metodo: 'PSE', estado: 'APROBADO', acreditado: true, creadoEn: '2026-11-01T11:00:00.000Z', actualizadoEn: '2026-11-01T11:01:00.000Z', banco: 'Banco que aprueba', medioWompi: 'PSE' }],
    ]),
    imagenes: new Map([
      ['img-escudo-1', { id: 'img-escudo-1', nombre: 'mil.svg', tipoMime: 'image/svg+xml', entidad: 'equipo', idEntidad: '1', creadoEn: '2026-11-01T00:00:00.000Z', contenido: BYTES_ESCUDO }],
      ['img-avatar-1', { id: 'img-avatar-1', nombre: 'yo.png', tipoMime: 'image/png', entidad: 'usuario', idEntidad: '1', creadoEn: '2026-11-01T00:00:00.000Z', contenido: Buffer.from([137, 80, 78, 71]) }],
      ['img-promo-1', { id: 'img-promo-1', nombre: 'promo.webp', tipoMime: 'image/webp', entidad: 'promocion', idEntidad: '1', creadoEn: '2026-11-01T00:00:00.000Z', contenido: Buffer.from([1, 2, 3]) }],
    ]),
    // Lo que recibieron los falsos, para que las pruebas lo revisen.
    registro: { contextos: [], billeterasAseguradas: [], pagadores: [], oauth: null, eventos: [], idsSolicitud: new Set() },
  };
}

/* ------------------------------------------------------------ servicios */

function aUsuarioProto(u) {
  return {
    id: u.id,
    email: u.email,
    nombres: u.nombres,
    apellidos: u.apellidos,
    nombreCompleto: `${u.nombres} ${u.apellidos}`.trim(),
    tipoDocumento: u.tipoDocumento,
    numeroDocumento: u.numeroDocumento,
    telefono: u.telefono,
    fechaNacimiento: u.fechaNacimiento,
    rol: u.rol,
    perfilCompleto: u.perfilCompleto,
    tienePassword: u.tienePassword,
    proveedores: u.proveedores,
    creadoEn: '2026-01-10T10:00:00.000Z',
  };
}

function autenticacion(d) {
  let contador = 0;
  const emitir = (u) => {
    contador += 1;
    const token = `tok-${u.id}-${contador}`;
    d.sesiones.set(token, { idUsuario: u.id, revocada: false });
    return { token, expiraEn: new Date(Date.now() + 7200000).toISOString(), usuario: aUsuarioProto(u), esNuevo: false };
  };
  const buscar = (identificador) =>
    [...d.usuarios.values()].find((u) => u.email === identificador || u.numeroDocumento === identificador);

  return implementacionParcial('autenticacion', {
    Salud: salud('ms-autenticacion', 'SQL Server'),
    async IniciarSesion(req, ctx) {
      d.registro.contextos.push(req.contexto);
      d.registro.idsSolicitud.add(ctx.idSolicitud);
      const u = buscar(req.identificador);
      if (!u || !u.clave || u.clave !== req.password) throw noAutenticado('Usuario o contraseña incorrectos');
      return emitir(u);
    },
    async Registrar(req) {
      d.registro.contextos.push(req.contexto);
      if (!String(req.email).includes('@')) {
        throw invalido('Revisa los datos del formulario', { campos: { email: 'Correo invalido' } });
      }
      if ([...d.usuarios.values()].some((u) => u.email === req.email)) throw yaExiste('Ya existe una cuenta con ese correo');
      const u = { id: d.siguienteUsuario++, email: req.email, clave: req.password, nombres: req.nombres, apellidos: req.apellidos, tipoDocumento: req.tipoDocumento, numeroDocumento: req.numeroDocumento, telefono: req.telefono, fechaNacimiento: req.fechaNacimiento, rol: 'cliente', perfilCompleto: true, tienePassword: true, proveedores: [] };
      d.usuarios.set(u.id, u);
      return emitir(u);
    },
    async ValidarToken(req) {
      const s = d.sesiones.get(req.token);
      if (!s || s.revocada) throw noAutenticado('Token inválido o vencido');
      const u = d.usuarios.get(s.idUsuario);
      return { idUsuario: u.id, rol: u.rol, jti: req.token, perfilCompleto: u.perfilCompleto, expiraEn: '2099-01-01T00:00:00.000Z' };
    },
    async CerrarSesion(req) {
      d.registro.contextos.push(req.contexto);
      const s = d.sesiones.get(req.token);
      if (s) s.revocada = true;
      return {};
    },
    async CerrarTodasLasSesiones(req) {
      let n = 0;
      for (const s of d.sesiones.values()) {
        if (s.idUsuario === req.idUsuario && !s.revocada) {
          s.revocada = true;
          n += 1;
        }
      }
      return { sesionesCerradas: n };
    },
    async ListarProveedores() {
      return { proveedores: [{ codigo: 'GOOGLE', nombre: 'Google', habilitado: true }, { codigo: 'MICROSOFT', nombre: 'Microsoft', habilitado: false }] };
    },
    async UrlAutorizacionExterna(req) {
      if (req.proveedor !== 'GOOGLE') throw precondicion('El inicio de sesión con Microsoft no está configurado');
      d.registro.oauth = { ...req };
      return { url: `https://accounts.google.test/o/oauth2/v2/auth?state=${req.state}&code_challenge=${req.codeChallenge}` };
    },
    async IniciarSesionExterna(req) {
      d.registro.contextos.push(req.contexto);
      const previo = d.registro.oauth;
      const reto = createHash('sha256').update(req.codeVerifier).digest('base64url');
      if (req.code !== 'codigo-bueno' || !previo || previo.nonce !== req.nonce || previo.codeChallenge !== reto || previo.redirectUri !== req.redirectUri) {
        throw noAutenticado('No pudimos validar tu cuenta de Google');
      }
      return { ...emitir(d.usuarios.get(4)), esNuevo: true };
    },
    async ObtenerUsuario(req) {
      const u = d.usuarios.get(req.idUsuario);
      if (!u) throw noEncontrado('Usuario no encontrado');
      return aUsuarioProto(u);
    },
    async ActualizarPerfil(req) {
      const u = d.usuarios.get(req.idUsuario);
      if (req.nombres !== undefined) u.nombres = req.nombres;
      if (req.apellidos !== undefined) u.apellidos = req.apellidos;
      if (req.telefono !== undefined) u.telefono = req.telefono;
      return aUsuarioProto(u);
    },
    async CompletarPerfil(req) {
      const u = d.usuarios.get(req.idUsuario);
      if (u.perfilCompleto) throw precondicion('Tu perfil ya estaba completo');
      Object.assign(u, { nombres: req.nombres, apellidos: req.apellidos, tipoDocumento: req.tipoDocumento, numeroDocumento: req.numeroDocumento, telefono: req.telefono, fechaNacimiento: req.fechaNacimiento, perfilCompleto: true });
      return aUsuarioProto(u);
    },
    async ListarTiposDocumento() {
      return { tipos: [{ codigo: 'CE', nombre: 'Cédula de extranjería' }, { codigo: 'CC', nombre: 'Cédula de ciudadanía' }] };
    },
    async BuscarCuenta(req) {
      const u = buscar(req.identificador);
      if (!u) throw noEncontrado('No encontramos una cuenta con esos datos');
      return { idUsuario: u.id, emailEnmascarado: '****@goldorado.co', telefonoEnmascarado: '***** 567', tieneEmail: true, tieneSms: Boolean(u.telefono) };
    },
    async SolicitarCodigo(req) {
      d.registro.contextos.push(req.contexto);
      return { token: 'sol-1', metodo: req.metodo, destinoEnmascarado: '****@goldorado.co', expiraEnMs: Date.now() + 600000, codigoDev: '482913' };
    },
    async VerificarCodigo(req) {
      if (req.token !== 'sol-1') throw precondicion('La solicitud ya no es válida. Pide un código nuevo.', { tokenDead: true });
      if (req.codigo !== '482913') throw invalido('Código incorrecto. Te quedan 4 intentos.');
      return { resetToken: 'reset-1' };
    },
    async RestablecerPassword(req) {
      if (req.resetToken !== 'reset-1') throw invalido('El enlace de recuperación no es válido');
      return { email: 'demo@goldorado.co' };
    },
  });
}

function deportes(d) {
  return implementacionParcial('deportes', {
    Salud: salud('ms-deportes', 'MySQL'),
    async ListarTorneos() {
      return { torneos: d.torneos };
    },
    async ListarEquipos(req) {
      const equipos = d.equipos.filter((e) => req.idTorneo === undefined || e.idTorneo === req.idTorneo);
      return { equipos: equipos.map((e) => ({ ...e, torneo: d.torneos.find((t) => t.id === e.idTorneo) })) };
    },
    async ObtenerEquipo(req) {
      const e = d.equipos.find((x) => x.id === req.id);
      if (!e) throw noEncontrado('Equipo no encontrado');
      return { ...e, torneo: d.torneos.find((t) => t.id === e.idTorneo) };
    },
    async ListarEncuentros(req) {
      const estado = req.estado && req.estado !== 'all' ? req.estado : null;
      let lista = d.encuentros.filter((e) => (!estado || e.estado === estado) && (req.idTorneo === undefined || e.idTorneo === req.idTorneo));
      if (req.limite) lista = lista.slice(0, req.limite);
      return { encuentros: lista };
    },
    async ListarDestacados(req) {
      return { encuentros: d.encuentros.filter((e) => e.destacado).slice(0, req.limite || 4) };
    },
    async ObtenerDetalleEncuentro(req) {
      const e = d.encuentros.find((x) => x.id === req.id);
      if (!e) throw noEncontrado('Partido no encontrado');
      return {
        encuentro: e,
        estadisticas: e.id === 1 ? { posesion: { local: 55, visitante: 45 }, tiros: { local: 9, visitante: 4 }, tirosArco: { local: 4, visitante: 1 }, faltas: { local: 8, visitante: 11 }, corners: { local: 5, visitante: 2 } } : null,
        alineacion: e.id === 1 ? [{ id: 1, idEquipo: 1, nombre: 'Santiago Bermúdez', dorsal: 9, posicion: 'DELANTERO', titular: true, goles: 1, asistencias: 0, minutos: 67 }] : [],
      };
    },
    async ObtenerEncuentrosPorIds(req) {
      return { encuentros: d.encuentros.filter((e) => req.ids.includes(e.id)) };
    },
    async ListarCalendario() {
      return {
        jornadas: [
          { idJornada: 2, numero: 2, fechaInicio: '2026-11-09', fechaFin: '2026-11-15', torneo: d.torneos[0], temporada: '2026-II', encuentros: d.encuentros.filter((e) => e.numeroJornada === 2) },
        ],
      };
    },
    async ListarJugadores() {
      return { jugadores: [{ id: 1, idEquipo: 1, nombres: 'Santiago', apellidos: 'Bermúdez', posicion: 'DELANTERO', dorsal: 9, fechaNacimiento: '2000-01-01', activo: true, equipo: 'Millonarios' }] };
    },
    async ListarEstadios() {
      return { estadios: [{ id: 1, nombre: 'El Campín', ciudad: 'Bogotá', pais: 'Colombia', capacidad: 36343 }] };
    },
  });
}

function apuestas(d) {
  let siguienteApuesta = 100;
  return implementacionParcial('apuestas', {
    Salud: salud('ms-apuestas', 'PostgreSQL'),
    async CuotasPorEncuentros(req) {
      return { cuotas: d.cuotas.filter((c) => req.idsEncuentro.includes(c.idEncuentro)) };
    },
    async RegistrarApuesta(req) {
      const c = d.cuotas.find((x) => x.idCuota === req.idCuota);
      if (!c) throw noEncontrado('La cuota seleccionada no existe');
      if (c.estado !== 'ABIERTO') throw precondicion('Esta cuota está cerrada en este momento');
      if (!Number.isInteger(req.monto) || req.monto <= 0) throw invalido('Ingresa un monto válido');
      const b = d.billeteras.get(req.idUsuario);
      if (!b || b.saldoDisponible < req.monto) throw precondicion('Saldo insuficiente');
      b.saldoDisponible -= req.monto;
      b.saldoBloqueado += req.monto;
      const apuesta = { id: siguienteApuesta++, idUsuario: req.idUsuario, estado: 'PENDIENTE', monto: req.monto, cuota: c.valor, gananciaPotencial: req.monto * c.valor, fecha: new Date().toISOString(), seleccion: c.seleccion, mercado: c.mercado, idEncuentro: c.idEncuentro, idTransaccion: `tx-${siguienteApuesta}` };
      d.apuestas.unshift(apuesta);
      return { idApuesta: apuesta.id, idTransaccion: apuesta.idTransaccion, monto: apuesta.monto, cuota: apuesta.cuota, gananciaPotencial: apuesta.gananciaPotencial, fecha: apuesta.fecha, idEncuentro: apuesta.idEncuentro, seleccion: apuesta.seleccion, mercado: apuesta.mercado, saldoDisponible: b.saldoDisponible, saldoBloqueado: b.saldoBloqueado };
    },
    async ListarApuestas(req) {
      return { apuestas: d.apuestas.filter((a) => a.idUsuario === req.idUsuario).slice(0, req.limite || 20) };
    },
    async ResumenApuestas(req) {
      const mias = d.apuestas.filter((a) => a.idUsuario === req.idUsuario);
      return { total: mias.length, ganadas: 0, perdidas: 0, pendientes: mias.length, apostado: mias.reduce((s, a) => s + a.monto, 0), retornado: 0, rendimiento: -100 };
    },
    async AsegurarBilletera(req) {
      d.registro.billeterasAseguradas.push(req.idUsuario);
      if (!d.billeteras.has(req.idUsuario)) {
        d.billeteras.set(req.idUsuario, { idUsuario: req.idUsuario, saldoDisponible: 0, saldoBloqueado: 0, moneda: 'COP' });
      }
      return d.billeteras.get(req.idUsuario);
    },
    async ObtenerBilletera(req) {
      const b = d.billeteras.get(req.idUsuario);
      if (!b) throw noEncontrado('El usuario no tiene billetera');
      return b;
    },
    async ListarPromociones(req) {
      let lista = d.promociones.filter((p) => !(req.excluirDestacada && p.destacada));
      if (req.limite) lista = lista.slice(0, req.limite);
      return { promociones: lista };
    },
    async PromocionDestacada() {
      const p = d.promociones.find((x) => x.destacada);
      if (!p) throw noEncontrado('No hay promociones disponibles');
      return p;
    },
    async ObtenerPromocion(req) {
      const p = d.promociones.find((x) => x.id === req.id);
      if (!p) throw noEncontrado('Promoción no encontrada');
      return p;
    },
  });
}

function transacciones(d) {
  return implementacionParcial('transacciones', {
    Salud: salud('ms-transacciones', 'MongoDB'),
    async ListarTransacciones(req) {
      return { transacciones: d.transacciones.filter((t) => t.idUsuario === req.idUsuario && (!req.tipo || t.tipo === req.tipo)) };
    },
  });
}

function pagos(d) {
  let n = 0;
  const crear = (req, metodo, extra = {}) => {
    n += 1;
    d.registro.pagadores.push(req.pagador);
    const pago = { referencia: `GD-${req.idUsuario}-${1762300000000 + n}-ab${n}`, idUsuario: req.idUsuario, monto: req.monto, moneda: 'COP', metodo, estado: 'PENDIENTE', acreditado: false, creadoEn: new Date().toISOString(), actualizadoEn: new Date().toISOString(), urlRetorno: req.urlRetorno, ...extra };
    d.pagos.set(pago.referencia, pago);
    return pago;
  };
  return implementacionParcial('pagos', {
    Salud: salud('ms-pagos', 'Firestore'),
    async ObtenerConfiguracion() {
      return { modo: 'simulado', llavePublica: '', moneda: 'COP', montoMinimo: 1500, montoMaximo: 5000000, metodos: ['PSE', 'CHECKOUT'], montosSugeridos: [20000, 50000], urlReglamento: '', urlDatosPersonales: '' };
    },
    async ListarBancosPse() {
      return { bancos: [{ codigo: '1', nombre: 'Banco que aprueba' }, { codigo: '2', nombre: 'Banco que rechaza' }] };
    },
    async CrearPagoPse(req) {
      if (!req.aceptaReglamento || !req.aceptaDatosPersonales) throw invalido('Debes aceptar el reglamento y la autorización de datos personales de Wompi');
      if (req.monto < 1500) throw invalido('El monto mínimo es $1.500');
      return crear(req, 'PSE', { banco: 'Banco que aprueba', medioWompi: 'PSE', urlPago: `${req.urlRetorno}?referencia=x&simulado=1` });
    },
    async CrearPagoCheckout(req) {
      return crear(req, 'CHECKOUT', { urlPago: 'https://checkout.wompi.test/p/abc' });
    },
    async ConsultarPago(req) {
      const pago = req.referencia
        ? d.pagos.get(req.referencia)
        : [...d.pagos.values()].find((p) => p.idTransaccionWompi === req.idTransaccionWompi);
      if (!pago) throw noEncontrado('Pago no encontrado');
      if (req.idUsuario && pago.idUsuario !== req.idUsuario) throw sinPermiso('No puedes ver ese pago');
      return pago;
    },
    async ListarPagos(req) {
      return { pagos: [...d.pagos.values()].filter((p) => p.idUsuario === req.idUsuario) };
    },
    async ProcesarEventoWompi(req) {
      d.registro.eventos.push(req);
      if (req.checksumCabecera !== 'firma-buena') throw noAutenticado('La firma del evento no coincide');
      const evento = JSON.parse(req.cuerpoJson);
      return { aceptado: true, referencia: evento.data.transaction.reference, estado: 'APROBADO' };
    },
  });
}

function imagenes(d) {
  const meta = (i) => ({ id: i.id, nombre: i.nombre, tipoMime: i.tipoMime, tamanoBytes: i.contenido.length, entidad: i.entidad, idEntidad: i.idEntidad, creadoEn: i.creadoEn, descripcion: i.descripcion });
  let n = 0;
  return implementacionParcial('imagenes', {
    Salud: salud('ms-imagenes', 'Google Drive'),
    async ObtenerImagen(req, ctx) {
      const i = d.imagenes.get(req.id);
      if (!i) throw noEncontrado('Imagen no encontrada');
      await ctx.escribir({ metadatos: meta(i) });
      for (let desde = 0; desde < i.contenido.length; desde += TROZO) {
        if (!(await ctx.escribir({ trozo: i.contenido.subarray(desde, desde + TROZO) }))) return;
      }
    },
    async ObtenerMetadatos(req) {
      const i = d.imagenes.get(req.id);
      if (!i) throw noEncontrado('Imagen no encontrada');
      return meta(i);
    },
    async BuscarImagenes(req) {
      const lista = [...d.imagenes.values()].filter(
        (i) => i.entidad === req.entidad && (req.idsEntidad.length === 0 || req.idsEntidad.includes(i.idEntidad))
      );
      return { imagenes: lista.map(meta) };
    },
    async SubirImagen(req) {
      if (req.reemplazar) {
        for (const [id, i] of d.imagenes) if (i.entidad === req.entidad && i.idEntidad === req.idEntidad) d.imagenes.delete(id);
      }
      n += 1;
      const i = { id: `img-nueva-${n}`, nombre: req.nombre, tipoMime: req.tipoMime, entidad: req.entidad, idEntidad: req.idEntidad, creadoEn: new Date().toISOString(), descripcion: req.descripcion, contenido: Buffer.from(req.contenido) };
      d.imagenes.set(i.id, i);
      return meta(i);
    },
    async EliminarImagen(req) {
      if (!d.imagenes.delete(req.id)) throw noEncontrado('Imagen no encontrada');
      return {};
    },
  });
}

const FABRICAS = { autenticacion, deportes, apuestas, transacciones, pagos, imagenes };

/**
 * Levanta los seis falsos. Devuelve:
 *   datos        estado en memoria (mutable) + registro de lo recibido
 *   direcciones  { clave: '127.0.0.1:puerto' } para crearClientes
 *   detener(c)   apaga de golpe UN servicio (simula que se cayo)
 *   apagar()     apaga todos
 */
export async function levantarFalsos() {
  const datos = datosSemilla();
  const servidores = {};
  const direcciones = {};
  for (const [clave, fabrica] of Object.entries(FABRICAS)) {
    const servidor = crearServidorGrpc({ nombre: `falso-${clave}`, log: logMudo });
    servidor.registrar(clave, fabrica(datos));
    const puerto = await servidor.iniciar(await puertoLibre(), '127.0.0.1');
    servidores[clave] = servidor;
    direcciones[clave] = `127.0.0.1:${puerto}`;
  }
  return {
    datos,
    direcciones,
    detener: async (clave) => {
      servidores[clave].servidor.forceShutdown();
    },
    apagar: async () => {
      for (const s of Object.values(servidores)) s.servidor.forceShutdown();
    },
  };
}
