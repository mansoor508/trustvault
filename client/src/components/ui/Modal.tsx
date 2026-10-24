import { useEffect, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons';

export interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Accessible dialog: labelled by its heading, closes on Escape or backdrop
 * click, locks body scroll while open, and receives focus on mount.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: ModalProps): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description !== undefined ? 'modal-description' : undefined}
      >
        <header className="modal-head">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description !== undefined ? (
              <p id="modal-description" className="muted">
                {description}
              </p>
            ) : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog">
            <IconClose />
          </button>
        </header>

        <div className="modal-body">{children}</div>

        {footer !== undefined ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
