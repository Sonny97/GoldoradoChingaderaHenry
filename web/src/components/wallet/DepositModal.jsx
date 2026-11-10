import { useState, useEffect, useCallback, useId } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useAsync } from '../../hooks/useAsync';
import * as paymentService from '../../services/paymentService';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import RadioCard from '../ui/RadioCard';
import Button from '../ui/Button';
import Alert from '../ui/Alert';
import Spinner from '../ui/Spinner';
import Icon from '../ui/icons';
import { formatCurrencyCOP } from '../../utils/format';
import { digitsOnly } from '../../utils/validators';
import { DOCUMENT_TYPES, LAST_PAYMENT_KEY, PAYMENT_STATUS } from '../../utils/constants';

/** Respaldo si /pagos/config no trae montos sugeridos. */
const MONTOS_POR_DEFECTO = [20000, 50000, 100000, 200000];

/** Wompi tarda unos segundos en generar la URL del banco PSE. */
const POLL_MS = 2000;
const POLL_MAX_MS = 90000;

/**
 * Guarda la referencia y se va al banco (o al checkout de Wompi).
 *
 * Vive fuera del componente a proposito: no depende de ningun estado, y asi el
 * efecto de sondeo la puede llamar sin tenerla como dependencia.
 *
 * La referencia va a sessionStorage porque algunos bancos PSE devuelven al
 * usuario recortando la query: /pagos/resultado la usa como respaldo. Se
 * envuelve en try/catch porque Safari en modo privado lanza al escribir.
 */
function irAlPago(payment) {
  try {
    sessionStorage.setItem(LAST_PAYMENT_KEY, payment.reference);
  } catch {
    // Sin sessionStorage la pagina de resultado igual tiene ?referencia=.
  }
  window.location.assign(payment.redirectUrl);
}

/**
 * Recarga de saldo con Wompi.
 *
 * El modal en si es delgado: el flujo vive en DepositFlow, que SOLO se monta
 * mientras el modal esta abierto. Asi la configuracion y los bancos se piden
 * al abrir (no al cargar /inicio) y cerrar el modal limpia todo el estado sin
 * un reset manual: la proxima vez arranca de cero.
 */
export default function DepositModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Recargar saldo">
      {open ? <DepositFlow /> : null}
    </Modal>
  );
}

function DepositFlow() {
  const { user } = useAuth();
  const tabsId = useId();

  const fetchConfig = useCallback(() => paymentService.getConfig(), []);
  const config = useAsync(fetchConfig, [], { initialData: null });

  const fetchBanks = useCallback(() => paymentService.getPseBanks(), []);
  const banks = useAsync(fetchBanks, [], { initialData: [] });

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('pse');
  const [bankCode, setBankCode] = useState('');
  const [personType, setPersonType] = useState(0);
  const [documentType, setDocumentType] = useState(user?.documentType || 'CC');
  const [documentNumber, setDocumentNumber] = useState(user?.documentNumber || '');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPersonalData, setAcceptPersonalData] = useState(false);

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Referencia de un pago PSE cuya URL de banco todavia no existe.
  const [pendingReference, setPendingReference] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  /**
   * Sondeo de "Preparando tu pago…". setTimeout encadenado y no setInterval:
   * si Wompi tarda mas de 2 s en contestar, setInterval apilaria peticiones
   * una encima de otra.
   */
  useEffect(() => {
    if (!pendingReference) return undefined;

    let cancelled = false;
    let timer;
    const startedAt = Date.now();

    async function tick() {
      const res = await paymentService.getPayment(pendingReference);
      if (cancelled) return;

      if (res.success && res.data) {
        if (res.data.redirectUrl) {
          setRedirecting(true);
          irAlPago(res.data);
          return;
        }
        if (res.data.status && res.data.status !== PAYMENT_STATUS.PENDING) {
          setPendingReference(null);
          setSubmitError(
            res.data.statusMessage || 'Wompi no pudo iniciar el pago. Intenta de nuevo o elige otro banco.'
          );
          return;
        }
      }

      if (Date.now() - startedAt >= POLL_MAX_MS) {
        setPendingReference(null);
        setSubmitError('El banco está tardando demasiado en responder. Intenta de nuevo en unos minutos.');
        return;
      }

      timer = setTimeout(tick, POLL_MS);
    }

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pendingReference]);

  if (config.isLoading) {
    return (
      <div className="gd-deposit__state">
        <Spinner size={32} label="Cargando medios de pago" />
        <p>Cargando medios de pago…</p>
      </div>
    );
  }

  if (config.error || !config.data) {
    return (
      <div className="gd-deposit__state">
        <Alert variant="error">{config.error || 'No pudimos cargar los medios de pago.'}</Alert>
        <Button variant="outline" size="sm" onClick={config.reload}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (pendingReference || redirecting) {
    return (
      <div className="gd-deposit__state" aria-live="polite">
        <Spinner size={36} label="Preparando tu pago" />
        <p className="gd-deposit__state-title">
          {redirecting ? 'Te estamos llevando al pago…' : 'Preparando tu pago…'}
        </p>
        <p className="gd-deposit__state-text">
          Wompi está generando el enlace seguro de tu banco. No cierres esta ventana.
        </p>
      </div>
    );
  }

  const cfg = config.data;
  const minAmount = Number(cfg.minAmount) || 0;
  const maxAmount = Number(cfg.maxAmount) || Number.MAX_SAFE_INTEGER;
  const presets = cfg.suggestedAmounts?.length ? cfg.suggestedAmounts : MONTOS_POR_DEFECTO;
  const isSimulated = cfg.mode === 'simulado';

  // Si la config dice que metodos hay, se respeta; si no trae la lista, se
  // ofrecen los dos.
  const methods = Array.isArray(cfg.methods) && cfg.methods.length ? cfg.methods.map(String) : null;
  const allowPse = !methods || methods.some((m) => /pse/i.test(m));
  const allowCheckout = !methods || methods.some((m) => !/pse/i.test(m));
  const activeMethod = method === 'pse' && !allowPse ? 'checkout' : method;

  // Wompi incluye en la lista un "A continuación seleccione su banco" con
  // codigo 0: no es un banco y no se ofrece.
  const bankOptions = (banks.data ?? [])
    .filter((b) => String(b.code) !== '0')
    .map((b) => ({ value: String(b.code), label: b.name }));

  function validate() {
    const next = {};
    const n = Number(amount);

    if (!amount) next.amount = 'Ingresa el monto a recargar';
    else if (!Number.isInteger(n)) next.amount = 'El monto debe ser un número entero';
    else if (n < minAmount) next.amount = `El monto mínimo es ${formatCurrencyCOP(minAmount)}`;
    else if (n > maxAmount) next.amount = `El monto máximo es ${formatCurrencyCOP(maxAmount)}`;

    if (activeMethod === 'pse') {
      if (!bankCode) next.bankCode = 'Selecciona tu banco';
      if (!documentType) next.documentType = 'Selecciona el tipo de documento';
      if (!documentNumber) next.documentNumber = 'Ingresa el documento del titular de la cuenta';
      else if (documentNumber.length < 5 || documentNumber.length > 15) {
        next.documentNumber = 'Documento inválido';
      }
      if (!acceptTerms) next.acceptTerms = 'Debes aceptar el reglamento de Wompi';
      if (!acceptPersonalData) next.acceptPersonalData = 'Debes autorizar el tratamiento de tus datos';
    }

    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError('');

    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setIsSubmitting(true);
    const value = Number(amount);
    const res =
      activeMethod === 'pse'
        ? await paymentService.createPsePayment({
            amount: value,
            bankCode,
            personType,
            documentType,
            documentNumber,
            acceptTerms,
            acceptPersonalData,
          })
        : await paymentService.createCheckoutPayment({ amount: value });
    setIsSubmitting(false);

    if (!res.success || !res.data) {
      setSubmitError(res.message || 'No pudimos iniciar el pago');
      return;
    }

    const payment = res.data;

    if (payment.status === PAYMENT_STATUS.ERROR || payment.status === PAYMENT_STATUS.DECLINED) {
      setSubmitError(payment.statusMessage || 'Wompi rechazó la solicitud de pago');
      return;
    }

    if (payment.redirectUrl) {
      setRedirecting(true);
      irAlPago(payment);
      return;
    }

    // PSE sin URL todavia: el efecto de arriba consulta cada 2 s.
    setPendingReference(payment.reference);
  }

  function clearError(name) {
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  }

  const legalLink = (url, text) =>
    url ? (
      <a className="gd-link-gold" href={url} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    ) : (
      text
    );

  return (
    <form className="gd-deposit" onSubmit={handleSubmit} noValidate>
      {isSimulated ? (
        <Alert variant="info" className="gd-deposit__notice">
          Modo de prueba: este pago es simulado y no se mueve dinero real.
        </Alert>
      ) : null}

      <fieldset className="gd-deposit__group">
        <legend className="gd-field__label">¿Cuánto quieres recargar?</legend>
        <div className="gd-deposit__amounts">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`gd-amount-chip ${Number(amount) === preset ? 'is-active' : ''}`.trim()}
              aria-pressed={Number(amount) === preset}
              onClick={() => {
                setAmount(String(preset));
                clearError('amount');
              }}
            >
              {formatCurrencyCOP(preset)}
            </button>
          ))}
        </div>

        <Input
          label="Otro monto"
          name="amount"
          inputMode="numeric"
          maxLength={10}
          placeholder="Ej. 75000"
          adornment="COP"
          icon={<Icon.Wallet size={20} />}
          value={amount}
          onChange={(e) => {
            setAmount(digitsOnly(e.target.value));
            clearError('amount');
          }}
          error={errors.amount}
          hint={`Mínimo ${formatCurrencyCOP(minAmount)}${cfg.maxAmount ? ` · máximo ${formatCurrencyCOP(maxAmount)}` : ''}`}
        />
      </fieldset>

      <div className="gd-tabs" role="tablist" aria-label="Medio de pago">
        {allowPse ? (
          <button
            type="button"
            role="tab"
            id={`${tabsId}-pse`}
            aria-selected={activeMethod === 'pse'}
            aria-controls={`${tabsId}-panel`}
            className={`gd-tabs__tab ${activeMethod === 'pse' ? 'is-active' : ''}`.trim()}
            onClick={() => setMethod('pse')}
          >
            <Icon.Bank size={16} />
            PSE
          </button>
        ) : null}
        {allowCheckout ? (
          <button
            type="button"
            role="tab"
            id={`${tabsId}-checkout`}
            aria-selected={activeMethod === 'checkout'}
            aria-controls={`${tabsId}-panel`}
            className={`gd-tabs__tab ${activeMethod === 'checkout' ? 'is-active' : ''}`.trim()}
            onClick={() => setMethod('checkout')}
          >
            <Icon.CreditCard size={16} />
            Otros medios (Wompi)
          </button>
        ) : null}
      </div>

      <div
        className="gd-deposit__panel"
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${activeMethod}`}
      >
        {activeMethod === 'pse' ? (
          <>
            <Select
              label="Banco"
              name="bankCode"
              required
              placeholder={banks.isLoading ? 'Cargando bancos…' : 'Selecciona tu banco'}
              options={bankOptions}
              icon={<Icon.Bank size={20} />}
              value={bankCode}
              onChange={(e) => {
                setBankCode(e.target.value);
                clearError('bankCode');
              }}
              error={errors.bankCode || banks.error}
            />

            <div className="gd-deposit__group">
              <span className="gd-field__label" id={`${tabsId}-person`}>
                Tipo de persona
              </span>
              <div className="gd-deposit__person" role="radiogroup" aria-labelledby={`${tabsId}-person`}>
                <RadioCard
                  selected={personType === 0}
                  onSelect={() => setPersonType(0)}
                  icon={<Icon.User size={20} />}
                  title="Persona natural"
                />
                <RadioCard
                  selected={personType === 1}
                  onSelect={() => setPersonType(1)}
                  icon={<Icon.IdCard size={20} />}
                  title="Persona jurídica"
                />
              </div>
            </div>

            <div className="gd-form-grid">
              <Select
                label="Tipo de documento"
                name="documentType"
                required
                options={DOCUMENT_TYPES}
                icon={<Icon.IdCard size={20} />}
                value={documentType}
                onChange={(e) => {
                  setDocumentType(e.target.value);
                  clearError('documentType');
                }}
                error={errors.documentType}
              />
              <Input
                label="Número de documento"
                name="documentNumber"
                inputMode="numeric"
                maxLength={15}
                required
                icon={<Icon.IdCard size={20} />}
                value={documentNumber}
                onChange={(e) => {
                  setDocumentNumber(digitsOnly(e.target.value));
                  clearError('documentNumber');
                }}
                error={errors.documentNumber}
                hint="El del titular de la cuenta bancaria"
              />
            </div>

            {/* Habeas Data (Ley 1581 de 2012): Wompi exige que el pagador
                acepte AMBOS documentos antes de cada transaccion PSE. Son dos
                casillas separadas y obligatorias, nunca una sola que agrupe las
                dos cosas. En modo simulado no hay URLs y se muestra el texto. */}
            <div className="gd-deposit__legal">
              <label className="gd-check gd-check--start">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  checked={acceptTerms}
                  onChange={(e) => {
                    setAcceptTerms(e.target.checked);
                    clearError('acceptTerms');
                  }}
                  aria-invalid={errors.acceptTerms ? true : undefined}
                />
                <span className="gd-check__box" aria-hidden="true">
                  <Icon.Check size={12} />
                </span>
                <span>{legalLink(cfg.termsUrl, 'Acepto el reglamento de usuarios de Wompi')}</span>
              </label>
              {errors.acceptTerms ? (
                <p className="gd-field__error" role="alert">
                  <Icon.Alert size={14} />
                  {errors.acceptTerms}
                </p>
              ) : null}

              <label className="gd-check gd-check--start">
                <input
                  type="checkbox"
                  name="acceptPersonalData"
                  checked={acceptPersonalData}
                  onChange={(e) => {
                    setAcceptPersonalData(e.target.checked);
                    clearError('acceptPersonalData');
                  }}
                  aria-invalid={errors.acceptPersonalData ? true : undefined}
                />
                <span className="gd-check__box" aria-hidden="true">
                  <Icon.Check size={12} />
                </span>
                <span>
                  {legalLink(cfg.personalDataUrl, 'Autorizo el tratamiento de mis datos personales')}
                </span>
              </label>
              {errors.acceptPersonalData ? (
                <p className="gd-field__error" role="alert">
                  <Icon.Alert size={14} />
                  {errors.acceptPersonalData}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="gd-deposit__hint">
            Paga con tarjeta débito o crédito, Nequi, Bancolombia y otros medios desde el checkout
            seguro de Wompi. Al terminar volverás a GolDorado automáticamente.
          </p>
        )}
      </div>

      {submitError ? <Alert variant="error">{submitError}</Alert> : null}

      <div className="gd-deposit__actions">
        <Button
          type="submit"
          variant="gold"
          size="lg"
          full
          loading={isSubmitting}
          iconRight={<Icon.ChevronRight size={18} />}
        >
          {amount ? `Recargar ${formatCurrencyCOP(amount)}` : 'Recargar'}
        </Button>
        <p className="gd-deposit__secure">
          <Icon.Lock size={14} />
          Pago procesado por Wompi. GolDorado nunca ve los datos de tu tarjeta ni de tu banco.
        </p>
      </div>
    </form>
  );
}
