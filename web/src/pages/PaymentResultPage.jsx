import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import * as paymentService from '../services/paymentService';
import AuthLayout from '../components/layout/AuthLayout';
import Card from '../components/ui/Card';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import Icon from '../components/ui/icons';
import { formatCurrencyCOP, formatDateTime } from '../utils/format';
import { LAST_PAYMENT_KEY, PAYMENT_STATUS, ROUTES } from '../utils/constants';

const POLL_MS = 2000;
const POLL_MAX_MS = 90000;

function leerUltimoPago() {
  try {
    return sessionStorage.getItem(LAST_PAYMENT_KEY) || '';
  } catch {
    return '';
  }
}

function olvidarUltimoPago() {
  try {
    sessionStorage.removeItem(LAST_PAYMENT_KEY);
  } catch {
    // Nada que limpiar si el navegador no deja usar sessionStorage.
  }
}

/** Textos e icono por estado final. */
const VISTAS = {
  [PAYMENT_STATUS.APPROVED]: {
    tone: 'success',
    title: '¡Recarga aprobada!',
    text: 'El dinero ya está en tu billetera y listo para apostar.',
  },
  [PAYMENT_STATUS.DECLINED]: {
    tone: 'error',
    title: 'Pago rechazado',
    text: 'Tu banco no aprobó la transacción. No se descontó dinero de tu cuenta.',
  },
  [PAYMENT_STATUS.VOIDED]: {
    tone: 'error',
    title: 'Pago anulado',
    text: 'La transacción fue anulada y no se acreditó saldo.',
  },
  [PAYMENT_STATUS.ERROR]: {
    tone: 'error',
    title: 'No pudimos procesar el pago',
    text: 'Ocurrió un error con el medio de pago. Intenta de nuevo en unos minutos.',
  },
};

/**
 * /pagos/resultado: a donde Wompi devuelve al usuario.
 *
 * LA URL NO DICE SI EL PAGO SALIO BIEN. Wompi agrega ?id= y el BFF ?referencia=,
 * pero cualquiera puede escribir esa URL a mano: el estado se pide siempre a
 * GET /api/pagos/:referencia, que lo consulta contra Wompi con la llave
 * privada. Por eso esta pagina nunca pinta "aprobado" sin la respuesta del
 * servidor.
 *
 * Fuentes de la referencia, en orden: ?referencia= (la pone ms-pagos), ?id=
 * (la transaccion de Wompi) y, si el banco recorto la query, la que
 * DepositModal dejo en sessionStorage antes de salir.
 *
 * PSE suele contestar en segundos pero puede tardar: mientras siga PENDIENTE se
 * consulta cada 2 s, hasta 90 s. Pasado ese plazo no se declara un fallo (el
 * banco puede aprobar despues y el webhook acreditara el saldo); se ofrece
 * consultar de nuevo.
 */
export default function PaymentResultPage() {
  const { refreshUser } = useAuth();
  const [params] = useSearchParams();
  const [fallbackRef] = useState(leerUltimoPago);

  const wompiId = params.get('id') || '';
  const reference = params.get('referencia') || (wompiId ? '' : fallbackRef);
  const isSimulated = params.get('simulado') === '1';
  const missing = !reference && !wompiId;

  // attempt reinicia el sondeo al pulsar "Consultar de nuevo".
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState({ phase: 'loading', payment: null, message: '' });

  useEffect(() => {
    if (missing) return undefined;

    let cancelled = false;
    let timer;
    const startedAt = Date.now();

    async function consultar() {
      let res = reference ? await paymentService.getPayment(reference) : null;
      if ((!res || !res.success) && wompiId) res = await paymentService.getPaymentByWompiId(wompiId);
      return res;
    }

    async function tick() {
      const res = await consultar();
      if (cancelled) return;

      if (!res?.success || !res.data) {
        setView({ phase: 'error', payment: null, message: res?.message || 'No pudimos consultar tu pago' });
        return;
      }

      const payment = res.data;

      if (payment.status === PAYMENT_STATUS.PENDING) {
        if (Date.now() - startedAt >= POLL_MAX_MS) {
          setView({ phase: 'timeout', payment, message: '' });
          return;
        }
        setView({ phase: 'pending', payment, message: '' });
        timer = setTimeout(tick, POLL_MS);
        return;
      }

      olvidarUltimoPago();
      setView({ phase: 'final', payment, message: '' });

      // El saldo del navbar sale de /auth/me: se relee para que muestre la
      // recarga sin que el usuario tenga que refrescar la pagina.
      if (payment.status === PAYMENT_STATUS.APPROVED) refreshUser();
    }

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [missing, reference, wompiId, attempt, refreshUser]);

  // Reintentar vuelve a "Consultando…" de inmediato, sin dejar el error viejo
  // en pantalla mientras llega la respuesta.
  function retry() {
    setView({ phase: 'loading', payment: null, message: '' });
    setAttempt((n) => n + 1);
  }

  const payment = view.payment;
  const final = view.phase === 'final' ? VISTAS[payment?.status] ?? VISTAS[PAYMENT_STATUS.ERROR] : null;

  let content;
  if (missing) {
    content = (
      <>
        <h1 className="gd-auth-card__title">No encontramos tu pago</h1>
        <Alert variant="error">
          Esta página no recibió la referencia de ningún pago. Revisa tus recargas en la billetera.
        </Alert>
      </>
    );
  } else if (view.phase === 'loading' || view.phase === 'pending') {
    content = (
      <div className="gd-payment-result__state" aria-live="polite">
        <Spinner size={40} label="Consultando tu pago" />
        <h1 className="gd-auth-card__title">
          {view.phase === 'loading' ? 'Consultando tu pago…' : 'Esperando la confirmación del banco…'}
        </h1>
        <p className="gd-auth-card__sub">Esto suele tardar unos segundos. No cierres esta ventana.</p>
      </div>
    );
  } else if (view.phase === 'timeout') {
    content = (
      <>
        <span className="gd-payment-result__icon gd-payment-result__icon--pending" aria-hidden="true">
          <Icon.Clock size={36} />
        </span>
        <h1 className="gd-auth-card__title">Tu pago sigue en proceso</h1>
        <p className="gd-auth-card__sub">
          El banco todavía no confirma la transacción. Si se aprueba, el saldo se acreditará
          automáticamente en tu billetera.
        </p>
        <Button variant="outline" onClick={retry}>
          Consultar de nuevo
        </Button>
      </>
    );
  } else if (view.phase === 'error') {
    content = (
      <>
        <h1 className="gd-auth-card__title">No pudimos consultar tu pago</h1>
        <Alert variant="error">{view.message}</Alert>
        <Button variant="outline" onClick={retry}>
          Reintentar
        </Button>
      </>
    );
  } else if (final) {
    content = (
      <>
        <span
          className={`gd-payment-result__icon gd-payment-result__icon--${final.tone}`}
          aria-hidden="true"
        >
          {final.tone === 'success' ? <Icon.CheckCircle size={40} /> : <Icon.Alert size={40} />}
        </span>
        <h1 className="gd-auth-card__title">{final.title}</h1>
        <p className="gd-auth-card__sub">{payment.statusMessage || final.text}</p>
      </>
    );
  }

  return (
    <AuthLayout>
      <Card className="gd-auth-card gd-payment-result" padding="lg" gold>
        {isSimulated ? (
          <Alert variant="info">Pago de prueba: no se movió dinero real.</Alert>
        ) : null}

        {content}

        {payment ? (
          <dl className="gd-payment-result__detail">
            <div>
              <dt>Monto</dt>
              <dd>{formatCurrencyCOP(payment.amount)}</dd>
            </div>
            <div>
              <dt>Medio</dt>
              <dd>
                {payment.method === 'PSE' ? 'PSE' : 'Wompi'}
                {payment.bank ? ` · ${payment.bank}` : ''}
              </dd>
            </div>
            <div>
              <dt>Referencia</dt>
              <dd className="gd-payment-result__ref">{payment.reference}</dd>
            </div>
            {payment.updatedAt ? (
              <div>
                <dt>Actualizado</dt>
                <dd>{formatDateTime(payment.updatedAt)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <div className="gd-payment-result__actions">
          <Button as={Link} to={ROUTES.WALLET} variant="gold" size="lg" full>
            Ir a mi billetera
          </Button>
          <Link className="gd-link-gold" to={ROUTES.DASHBOARD}>
            Volver al inicio
          </Link>
        </div>
      </Card>
    </AuthLayout>
  );
}
