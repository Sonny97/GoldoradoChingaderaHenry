import { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import Icon from './icons';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Dialogo modal con portal, trampa de foco, Escape y bloqueo de scroll.
 *
 * El cleanup restaura SIEMPRE el overflow del body y devuelve el foco al
 * elemento que abrio el modal: sin eso, cerrar deja la pagina sin poder
 * hacer scroll y al usuario de teclado perdido en <body>.
 */
export default function Modal({
  open,
  onClose,
  title,
  footer,
  closeOnBackdrop = true,
  children,
}) {
  const panelRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;

    // Compensa el ancho de la barra de scroll o la pagina da un salto lateral.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const nodes = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes?.length) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    (panelRef.current?.querySelector('[data-autofocus]') || panelRef.current)?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="gd-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className="gd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <header className="gd-modal__head">
          {title ? (
            <h2 id={titleId} className="gd-modal__title">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="gd-modal__close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon.Close size={18} />
          </button>
        </header>

        <div className="gd-modal__body">{children}</div>

        {footer ? <footer className="gd-modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
