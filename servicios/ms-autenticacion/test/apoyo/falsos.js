/**
 * Dobles de prueba: repositorios en memoria, auditoria que anota y reloj
 * manual. Permiten probar los servicios SIN SQL Server ni red.
 *
 * Sin efectos al importarse: node --test ejecuta tambien este archivo (vive
 * bajo test/) y no debe hacer nada por si solo.
 *
 * Las filas imitan EXACTAMENTE lo que devuelve SELECT_PERFIL de usuarioRepo
 * (snake_case, BIT como booleano), para que el servicio no note la diferencia.
 */

import bcrypt from 'bcryptjs';

/** bcrypt con costo 4: mismo formato que el real, 60 veces mas rapido. */
export const hashRapido = (clave) => bcrypt.hashSync(clave, 4);

/** Reloj manual: las pruebas de vencimiento avanzan minutos sin esperar. */
export function crearReloj(inicioIso = '2026-11-09T15:00:00.000Z') {
  let ahora = Date.parse(inicioIso);
  return {
    ahora: () => ahora,
    avanzar(ms) {
      ahora += ms;
    },
  };
}

/** Auditoria que solo anota lo que le pidieron registrar. */
export function crearAuditoriaFalsa() {
  const intentos = [];
  const eventos = [];
  return {
    intentos,
    eventos,
    intentoSesion: async (datos) => {
      intentos.push(datos);
      return null;
    },
    evento: async (tipo, datos = {}) => {
      eventos.push({ tipo, ...datos });
      return null;
    },
    cerrar() {},
  };
}

export const TIPOS_DOCUMENTO = [
  { codigo: 'CC', nombre: 'Cédula de ciudadanía' },
  { codigo: 'CE', nombre: 'Cédula de extranjería' },
  { codigo: 'NIT', nombre: 'NIT' },
  { codigo: 'PA', nombre: 'Pasaporte' },
  { codigo: 'TI', nombre: 'Tarjeta de identidad' },
];

/** Fila de usuario con los valores de Camilo (usuario 1 del seed). */
export function filaUsuario(datos = {}) {
  return {
    id_usuario: '1', // BIGINT llega como texto desde mssql
    email: 'demo@goldorado.co',
    password_hash: null,
    activo: true,
    fecha_creacion: new Date('2026-01-10T10:00:00Z'),
    ultimo_login: null,
    tiene_cliente: true,
    nombres: 'Camilo',
    apellidos: 'Rojas',
    tipo_documento: 'CC',
    numero_documento: '1012345678',
    fecha_nacimiento: new Date('1996-03-11T00:00:00Z'),
    rol: 'CLIENTE',
    telefono: '3001234567',
    nombre_proveedor: null,
    proveedores: null,
    ...datos,
  };
}

/** Error con la misma forma que lanza usuarioRepo cuando salta un UNIQUE. */
export const errorDuplicado = (duplicado) => Object.assign(new Error(`duplicado ${duplicado}`), { duplicado });

/** usuarioRepo en memoria (usuarios + fichas + cuentas externas). */
export function crearUsuariosFalsos(filas = []) {
  const tabla = new Map(filas.map((f) => [Number(f.id_usuario), { ...f }]));
  const cuentas = [];
  let siguienteId = 100;
  let siguienteCuenta = 1;

  const conProveedores = (fila) => {
    if (!fila) return null;
    const propias = cuentas.filter((c) => c.id_usuario === Number(fila.id_usuario));
    const ordenadas = propias.map((c) => c.proveedor).sort();
    return {
      ...fila,
      proveedores: ordenadas.length ? ordenadas.join(',') : null,
      nombre_proveedor: fila.nombre_proveedor ?? propias.find((c) => c.nombre)?.nombre ?? null,
    };
  };
  const porEmail = (email) =>
    [...tabla.values()].find((f) => f.email.toLowerCase() === String(email).toLowerCase()) ?? null;

  return {
    tabla,
    cuentas,
    /** Para simular la carrera: el proximo INSERT falla con este duplicado. */
    fallarProximoInsert: null,

    async buscarPorIdentificador(ident) {
      const fila = [...tabla.values()].find((f) => f.email === ident || f.numero_documento === ident);
      return conProveedores(fila ?? null);
    },
    async buscarPorId(id) {
      return conProveedores(tabla.get(Number(id)) ?? null);
    },
    async buscarPorEmail(email) {
      return conProveedores(porEmail(email));
    },
    async existeEmail(email) {
      return Boolean(porEmail(email));
    },
    async existeDocumento(documento) {
      return [...tabla.values()].some((f) => f.numero_documento === documento);
    },
    async listarTiposDocumento() {
      return TIPOS_DOCUMENTO;
    },
    async crearCliente({ email, passwordHash, ...ficha }) {
      if (this.fallarProximoInsert) {
        const duplicado = this.fallarProximoInsert;
        this.fallarProximoInsert = null;
        throw errorDuplicado(duplicado);
      }
      const id = siguienteId++;
      tabla.set(
        id,
        filaUsuario({
          id_usuario: String(id),
          email,
          password_hash: passwordHash,
          fecha_creacion: new Date(),
          nombres: ficha.nombres,
          apellidos: ficha.apellidos,
          tipo_documento: ficha.tipoDocumento,
          numero_documento: ficha.numeroDocumento,
          fecha_nacimiento: ficha.fechaNacimiento,
          telefono: ficha.telefono,
        })
      );
      return this.buscarPorId(id);
    },
    async completarPerfil(id, ficha) {
      const fila = tabla.get(Number(id));
      Object.assign(fila, {
        tiene_cliente: true,
        nombres: ficha.nombres,
        apellidos: ficha.apellidos,
        tipo_documento: ficha.tipoDocumento,
        numero_documento: ficha.numeroDocumento,
        fecha_nacimiento: ficha.fechaNacimiento,
        telefono: ficha.telefono,
      });
      return this.buscarPorId(id);
    },
    async actualizarPerfil(id, { nombres, apellidos, telefono }) {
      const fila = tabla.get(Number(id));
      if (nombres !== undefined) fila.nombres = nombres;
      if (apellidos !== undefined) fila.apellidos = apellidos;
      if (telefono !== undefined) fila.telefono = telefono;
      return this.buscarPorId(id);
    },
    async actualizarUltimoLogin(id) {
      tabla.get(Number(id)).ultimo_login = new Date();
    },
    async buscarCuentaExterna({ proveedor, inquilino, sujeto }) {
      const cuenta = cuentas.find(
        (c) => c.proveedor === proveedor && c.inquilino === inquilino && c.sujeto === sujeto
      );
      return cuenta ? { id_cuenta_externa: cuenta.id, id_usuario: String(cuenta.id_usuario) } : null;
    },
    async registrarUsoCuentaExterna(idCuenta) {
      cuentas.find((c) => c.id === idCuenta).ultimo_uso = new Date();
    },
    async vincularCuentaExterna(idUsuario, cuenta) {
      if (cuentas.some((c) => c.id_usuario === Number(idUsuario) && c.proveedor === cuenta.proveedor)) {
        throw errorDuplicado('proveedor_vinculado');
      }
      cuentas.push({ id: siguienteCuenta++, id_usuario: Number(idUsuario), ...cuenta });
    },
    async crearUsuarioExterno(cuenta) {
      if (porEmail(cuenta.email)) throw errorDuplicado('email');
      const id = siguienteId++;
      tabla.set(
        id,
        filaUsuario({
          id_usuario: String(id),
          email: cuenta.email,
          password_hash: null,
          tiene_cliente: false,
          nombres: null,
          apellidos: null,
          tipo_documento: null,
          numero_documento: null,
          fecha_nacimiento: null,
          telefono: null,
        })
      );
      cuentas.push({ id: siguienteCuenta++, id_usuario: id, ...cuenta });
      return this.buscarPorId(id);
    },
  };
}

/** sesionRepo en memoria; consulta al repo de usuarios como el JOIN real. */
export function crearSesionesFalsas(usuarios) {
  const filas = new Map();
  return {
    filas,
    async crear({ jti, idUsuario, proveedor, emitidaEn, expiraEn, ip, userAgent }) {
      filas.set(jti, {
        jti,
        id_usuario: String(idUsuario),
        proveedor,
        emitida_en: emitidaEn,
        expira_en: expiraEn,
        revocada_en: null,
        motivo_revocacion: null,
        ip,
        user_agent: userAgent,
      });
    },
    async buscarParaValidar(jti) {
      const sesion = filas.get(jti);
      if (!sesion) return null;
      const usuario = usuarios.tabla.get(Number(sesion.id_usuario));
      return { ...sesion, activo: usuario.activo, tiene_cliente: usuario.tiene_cliente, rol: usuario.rol };
    },
    async revocar(jti, motivo, ahora) {
      const sesion = filas.get(jti);
      if (!sesion || sesion.revocada_en) return 0;
      Object.assign(sesion, { revocada_en: ahora, motivo_revocacion: motivo });
      return 1;
    },
    async revocarTodas(idUsuario, motivo, ahora) {
      let cerradas = 0;
      for (const sesion of filas.values()) {
        if (Number(sesion.id_usuario) === Number(idUsuario) && !sesion.revocada_en && sesion.expira_en > ahora) {
          Object.assign(sesion, { revocada_en: ahora, motivo_revocacion: motivo });
          cerradas += 1;
        }
      }
      return cerradas;
    },
  };
}

/** recuperacionRepo en memoria, con las mismas condiciones de los WHERE reales. */
export function crearRecuperacionesFalsas({ usuarios, sesiones }) {
  const filas = new Map();
  return {
    filas,
    async crear({ token, idUsuario, metodo, codigoHash, expiraEn, creadaEn }) {
      filas.set(token, {
        token,
        id_usuario: String(idUsuario),
        metodo,
        codigo_hash: codigoHash,
        intentos: 0,
        expira_en: expiraEn,
        verificada_en: null,
        reset_token: null,
        usada_en: null,
        creada_en: creadaEn,
      });
    },
    async buscarPorToken(token) {
      const fila = filas.get(token);
      return fila ? { ...fila } : null;
    },
    async buscarPorResetToken(resetToken) {
      const fila = [...filas.values()].find((f) => f.reset_token && f.reset_token === resetToken);
      return fila ? { ...fila } : null;
    },
    async sumarIntento(token, maximo) {
      const fila = filas.get(token);
      if (!fila || fila.intentos >= maximo) return null;
      fila.intentos += 1;
      return fila.intentos;
    },
    async marcarVerificada(token, resetToken, ahora) {
      const fila = filas.get(token);
      if (!fila || fila.usada_en) return false;
      Object.assign(fila, { verificada_en: ahora, reset_token: resetToken });
      return true;
    },
    async consumirYCambiarPassword({ token, idUsuario, passwordHash, ahora }) {
      const fila = filas.get(token);
      if (!fila || fila.usada_en || !fila.reset_token || !(fila.expira_en > ahora)) {
        return { consumida: false, actualizado: false, sesionesRevocadas: 0 };
      }
      fila.usada_en = ahora;
      const usuario = usuarios.tabla.get(Number(idUsuario));
      const actualizado = Boolean(usuario?.activo);
      if (actualizado) usuario.password_hash = passwordHash;
      const sesionesRevocadas = actualizado
        ? await sesiones.revocarTodas(idUsuario, 'RESTABLECER_PASSWORD', ahora)
        : 0;
      return { consumida: true, actualizado, sesionesRevocadas };
    },
  };
}
