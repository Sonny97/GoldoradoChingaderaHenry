/**
 * Verificacion de extremo a extremo del sistema COMPLETO, solo por REST.
 *
 *   npm run verificar -w bff        (BFF_URL=http://localhost:3000 por defecto)
 *
 * A diferencia de las pruebas (test/), aqui no hay nada falso: el BFF y los seis
 * microservicios tienen que estar corriendo con sus bases (SQL Server, MySQL,
 * PostgreSQL, MongoDB, Firestore o memoria, Drive o local). Cada paso es una
 * peticion HTTP real, igual a la que hace el navegador, y se comprueba su
 * efecto a traves de OTRA ruta (el saldo despues de apostar, el historial, el
 * libro de movimientos). Es la prueba de que las seis piezas estan conectadas
 * de verdad, y sirve para demostrarlo en la sustentacion sin abrir Postman.
 *
 * Efectos que deja: una apuesta PENDIENTE de $5.000 del usuario demo. En modo
 * de pagos `simulado` tambien un deposito aprobado por el mismo monto, asi que
 * el saldo DISPONIBLE del demo termina donde empezo (los $5.000 quedan en
 * saldo bloqueado hasta que el partido se liquide).
 */

const BASE = (process.env.BFF_URL || 'http://localhost:3000').replace(/\/+$/, '');
const MONTO_APUESTA = 5000;
const DEMO = { correo: 'demo@goldorado.co', documento: '1012345678', clave: 'Demo1234!' };

/* -------------------------------------------------------------- utilidades */

let correctas = 0;
let fallidas = 0;

function comprobar(descripcion, condicion, detalle = '') {
  if (condicion) {
    correctas += 1;
    console.log(`  [OK]    ${descripcion}`);
  } else {
    fallidas += 1;
    console.log(`  [FALLA] ${descripcion}${detalle ? `  -> ${detalle}` : ''}`);
  }
  return Boolean(condicion);
}

const seccion = (titulo) => console.log(`\n== ${titulo} ${'='.repeat(Math.max(0, 58 - titulo.length))}`);

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(metodo, ruta, { cuerpo, token } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let sobre = null;
  try {
    sobre = await res.json();
  } catch {
    sobre = null;
  }
  return { estado: res.status, sobre };
}

/** Repite `intento` hasta que devuelva algo verdadero o se acabe el plazo. */
async function hastaQue(intento, { plazoMs = 15000, cadaMs = 1000 } = {}) {
  const limite = Date.now() + plazoMs;
  let ultimo;
  while (Date.now() < limite) {
    ultimo = await intento();
    if (ultimo) return ultimo;
    await esperar(cadaMs);
  }
  return ultimo;
}

const resumen = (r) => `HTTP ${r.estado} ${r.sobre?.message ?? ''}`.trim();

/* ------------------------------------------------------------------ prueba */

async function main() {
  console.log(`Verificando GolDorado por REST en ${BASE}`);

  seccion('Salud de los seis microservicios');
  const salud = await pedir('GET', '/api/salud');
  const servicios = salud.sobre?.data?.servicios ?? [];
  comprobar('GET /api/salud responde 200', salud.estado === 200, resumen(salud));
  for (const s of servicios) {
    comprobar(
      `${s.servicio} ok (${s.motor ?? '?'}${s.modo ? `, ${s.modo}` : ''})`,
      s.estado === 'ok',
      `${s.estado}: ${s.detalle}`
    );
  }
  comprobar('responden los 6 servicios', servicios.length === 6, `llegaron ${servicios.length}`);

  seccion('Inicio de sesion (ms-autenticacion, SQL Server)');
  const porCorreo = await pedir('POST', '/api/auth/login', { cuerpo: { username: DEMO.correo, password: DEMO.clave } });
  const token = porCorreo.sobre?.data?.token;
  comprobar('login con correo -> 200 y token', porCorreo.estado === 200 && Boolean(token), resumen(porCorreo));
  if (!token) throw new Error('Sin token del usuario demo no se puede seguir. ¿Corriste el setup de las bases?');

  const porDocumento = await pedir('POST', '/api/auth/login', { cuerpo: { username: DEMO.documento, password: DEMO.clave } });
  comprobar('login con numero de documento -> 200', porDocumento.estado === 200, resumen(porDocumento));
  // Se cierra de una vez: no hace falta y no debe quedar una sesion abierta de mas.
  if (porDocumento.sobre?.data?.token) await pedir('POST', '/api/auth/logout', { token: porDocumento.sobre.data.token });

  const claveMala = await pedir('POST', '/api/auth/login', { cuerpo: { username: DEMO.correo, password: 'NoEsLaClave1!' } });
  comprobar(
    'clave incorrecta -> 401 con mensaje generico',
    claveMala.estado === 401 && claveMala.sobre?.message === 'Usuario o contraseña incorrectos',
    resumen(claveMala)
  );

  for (const intento of ["' OR 1=1 --", "demo@goldorado.co' --", "1; DROP TABLE Usuario; --"]) {
    const r = await pedir('POST', '/api/auth/login', { cuerpo: { username: intento, password: "' OR '1'='1" } });
    comprobar(`inyeccion SQL rechazada: ${intento}`, r.estado === 401, resumen(r));
  }

  const me = await pedir('GET', '/api/auth/me', { token });
  const saldoInicial = me.sobre?.data?.balance;
  comprobar('GET /api/auth/me -> User del demo', me.estado === 200 && me.sobre?.data?.id === 1, resumen(me));
  comprobar(
    `perfil con saldo de ms-apuestas ($${saldoInicial})`,
    typeof saldoInicial === 'number',
    `balance = ${saldoInicial}`
  );

  seccion('Partidos con cuotas (ms-deportes + ms-apuestas + ms-imagenes)');
  const partidos = await pedir('GET', '/api/encuentros');
  const lista = partidos.sobre?.data ?? [];
  comprobar(`GET /api/encuentros -> ${lista.length} partidos`, partidos.estado === 200 && lista.length > 0, resumen(partidos));
  comprobar('los partidos traen cuotas', lista.some((m) => m.odds?.length > 0));
  comprobar('los equipos traen escudo de ms-imagenes', lista.some((m) => m.homeTeam?.crestUrl), 'crestUrl null en todos');

  const proximo = lista.find((m) => m.status === 'upcoming' && m.odds?.some((o) => o.open));
  const cuota = proximo?.odds.find((o) => o.open);
  comprobar('hay un partido proximo con cuota abierta', Boolean(cuota));

  seccion('Apuesta de $5.000 (ms-apuestas, PostgreSQL)');
  let apuesta = null;
  if (cuota) {
    const r = await pedir('POST', '/api/apuestas', { token, cuerpo: { oddsId: cuota.oddsId, amount: MONTO_APUESTA } });
    apuesta = r.sobre?.data;
    comprobar(
      `apuesta a "${cuota.label}" de ${proximo.homeTeam?.name} vs ${proximo.awayTeam?.name} @ ${cuota.value} -> 201`,
      r.estado === 201 && Boolean(apuesta?.betId),
      resumen(r)
    );
    const despues = await pedir('GET', '/api/auth/me', { token });
    const saldoDespues = despues.sobre?.data?.balance;
    comprobar(
      'el saldo bajo exactamente $5.000',
      typeof saldoInicial === 'number' && saldoInicial - saldoDespues === MONTO_APUESTA,
      `antes ${saldoInicial}, despues ${saldoDespues}`
    );
  }

  const historial = await pedir('GET', '/api/apuestas?limite=20', { token });
  const enHistorial = (historial.sobre?.data ?? []).find((a) => a.id === apuesta?.betId);
  comprobar('la apuesta aparece en el historial', Boolean(enHistorial), resumen(historial));
  comprobar('el historial trae el partido desde ms-deportes', Boolean(enHistorial?.match?.home), JSON.stringify(enHistorial?.match));

  const resumenApuestas = await pedir('GET', '/api/apuestas/resumen', { token });
  comprobar(
    `resumen: ${resumenApuestas.sobre?.data?.total} apuestas, ${resumenApuestas.sobre?.data?.pending} pendientes`,
    resumenApuestas.estado === 200 && resumenApuestas.sobre?.data?.total >= 1,
    resumen(resumenApuestas)
  );

  seccion('Libro de movimientos (ms-transacciones, MongoDB)');
  // La apuesta llega al libro por el outbox de ms-apuestas (cada pocos segundos).
  const movimiento = await hastaQue(async () => {
    const r = await pedir('GET', '/api/billetera/movimientos?limite=50', { token });
    return (r.sobre?.data ?? []).find((m) => m.code === apuesta?.transactionId);
  });
  comprobar('GET /api/billetera/movimientos responde', (await pedir('GET', '/api/billetera/movimientos', { token })).estado === 200);
  comprobar('la apuesta quedo en el libro de MongoDB (outbox)', Boolean(movimiento), `transaccion ${apuesta?.transactionId}`);

  seccion('Pagos con Wompi (ms-pagos)');
  const config = await pedir('GET', '/api/pagos/config');
  const modo = config.sobre?.data?.mode;
  comprobar(`GET /api/pagos/config -> modo ${modo}`, config.estado === 200 && Boolean(modo), resumen(config));

  if (modo === 'simulado') {
    const monto = Math.max(MONTO_APUESTA, Number(config.sobre.data.minAmount) || 0);
    const antes = (await pedir('GET', '/api/auth/me', { token })).sobre?.data?.balance;
    const pago = await pedir('POST', '/api/pagos/pse', {
      token,
      cuerpo: { amount: monto, bankCode: '1', personType: 0, acceptTerms: true, acceptPersonalData: true },
    });
    const referencia = pago.sobre?.data?.reference;
    comprobar(`deposito PSE simulado de $${monto} -> 201`, pago.estado === 201 && Boolean(referencia), resumen(pago));

    if (referencia) {
      const aprobado = await hastaQue(async () => {
        const r = await pedir('GET', `/api/pagos/${encodeURIComponent(referencia)}`, { token });
        return r.sobre?.data?.status === 'APROBADO' ? r.sobre.data : null;
      });
      comprobar(`el pago ${referencia} quedo APROBADO`, Boolean(aprobado));
      comprobar('y acreditado en ms-apuestas', aprobado?.credited === true);
      const saldo = await hastaQue(async () => {
        const b = (await pedir('GET', '/api/auth/me', { token })).sobre?.data?.balance;
        return b - antes === monto ? b : null;
      });
      comprobar(`el saldo subio exactamente $${monto}`, saldo !== null && saldo !== undefined, `antes ${antes}`);
    }
  } else {
    console.log(`  (modo ${modo}: el deposito real necesita el banco de pruebas de Wompi; se omite)`);
  }

  seccion('Cierre de sesion (tabla Sesion)');
  const salir = await pedir('POST', '/api/auth/logout', { token });
  comprobar('POST /api/auth/logout -> 200', salir.estado === 200, resumen(salir));
  const revocado = await pedir('GET', '/api/auth/me', { token });
  comprobar('el token revocado ya no sirve -> 401', revocado.estado === 401, resumen(revocado));

  console.log(`\n${'='.repeat(64)}`);
  console.log(`  RESULTADO:  ${correctas} correctas,  ${fallidas} fallidas`);
  console.log(`${'='.repeat(64)}\n`);

  process.exit(fallidas === 0 ? 0 : 1);
}

main().catch((error) => {
  const causa = error?.cause?.code ?? error?.code;
  console.error('\n[X] La verificacion no pudo terminar:', error.message);
  if (causa === 'ECONNREFUSED' || error?.message === 'fetch failed') {
    console.error(`    Nadie escucha en ${BASE}. ¿Esta corriendo el BFF?  (npm run dev en la raiz del monorepo)`);
  }
  console.log(`\n  RESULTADO:  ${correctas} correctas,  ${fallidas + 1} fallidas\n`);
  process.exit(1);
});
