/**
 * Datos semilla de pagos (CONVENCIONES §5), compartidos por el repositorio en
 * memoria (se cargan al arrancar) y por db/02_datos.js (Firestore).
 *
 * Son los dos depositos que ya aparecen acreditados en ms-apuestas
 * (movimiento_saldo con referencia GD-SEED-000x) y en el libro de
 * ms-transacciones: la referencia es la misma clave en las tres bases.
 * Las fechas son relativas al momento del seed para que la demo no muestre
 * pagos "de hace anios".
 */

const DIA = 24 * 60 * 60 * 1000;

/** @returns {Array<{ pago: object, eventos: object[] }>} */
export function pagosSemilla(ahora = new Date()) {
  const hace = (dias, minutos = 0) => new Date(ahora.getTime() - dias * DIA + minutos * 60 * 1000);

  const definiciones = [
    {
      referencia: 'GD-SEED-0001',
      idUsuario: 1,
      monto: 300000,
      metodo: 'CHECKOUT',
      medioWompi: 'NEQUI',
      idTransaccionWompi: '12-1762300000-10001',
      banco: null,
      tipoPersona: null,
      pagador: {
        email: 'demo@goldorado.co',
        nombreCompleto: 'Camilo Rojas',
        telefono: '573001234567',
        tipoDocumento: 'CC',
        numeroDocumento: '1012345678',
      },
      dias: 10,
    },
    {
      referencia: 'GD-SEED-0002',
      idUsuario: 2,
      monto: 100000,
      metodo: 'PSE',
      medioWompi: 'PSE',
      idTransaccionWompi: '12-1762400000-10002',
      banco: { codigo: '1', nombre: 'Banco que aprueba' },
      tipoPersona: 0,
      pagador: {
        email: 'valentina.mesa@hotmail.com',
        nombreCompleto: 'Valentina Mesa',
        telefono: '573109876123',
        tipoDocumento: 'CC',
        numeroDocumento: '1098765432',
      },
      dias: 8,
    },
  ];

  return definiciones.map((d) => {
    const creadoEn = hace(d.dias);
    const aprobadoEn = hace(d.dias, 2);
    const urlRedireccion = `http://localhost:3003/pagos/resultado?referencia=${d.referencia}`;
    const pago = {
      referencia: d.referencia,
      idUsuario: d.idUsuario,
      monto: d.monto,
      montoCentavos: d.monto * 100,
      moneda: 'COP',
      metodo: d.metodo,
      estado: 'APROBADO',
      mensajeEstado: null,
      idTransaccionWompi: d.idTransaccionWompi,
      idsTransaccionWompi: [d.idTransaccionWompi],
      idTransaccionAprobada: d.idTransaccionWompi,
      aprobacionesDuplicadas: [],
      urlPago: d.metodo === 'PSE' ? 'https://sandbox.wompi.co/v1/pse/redirect?ticket_id=semilla' : null,
      urlRedireccion,
      banco: d.banco,
      tipoPersona: d.tipoPersona,
      pagador: d.pagador,
      medioWompi: d.medioWompi,
      ambiente: 'sandbox',
      acreditado: true,
      acreditadoEn: aprobadoEn,
      libroPendiente: false,
      libroEstado: 'COMPLETADO',
      creadoEn,
      actualizadoEn: aprobadoEn,
    };
    const eventos = [
      { tipo: 'CREADO', origen: 'SEMILLA', estadoAnterior: null, estadoNuevo: 'PENDIENTE', fecha: creadoEn },
      {
        tipo: 'ESTADO_WOMPI',
        origen: 'WEBHOOK',
        estadoAnterior: 'PENDIENTE',
        estadoNuevo: 'APROBADO',
        idTransaccionWompi: d.idTransaccionWompi,
        payload: JSON.stringify({
          id: d.idTransaccionWompi,
          reference: d.referencia,
          amount_in_cents: d.monto * 100,
          currency: 'COP',
          status: 'APPROVED',
          payment_method_type: d.medioWompi,
        }),
        fecha: aprobadoEn,
      },
      {
        tipo: 'ACREDITADO',
        origen: 'WEBHOOK',
        estadoAnterior: 'APROBADO',
        estadoNuevo: 'APROBADO',
        detalle: 'ms-apuestas.AcreditarDeposito aplicado',
        fecha: aprobadoEn,
      },
    ];
    return { pago, eventos };
  });
}
