import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { PixelIcon, type IconName } from './PixelIcon';
import '../styles/ui.css';

export function Window({
  title,
  icon,
  tone = 'pink',
  controls,
  children,
  className = '',
  titleId,
  level = 2,
}: {
  title: ReactNode;
  icon?: IconName;
  tone?: 'pink' | 'blue' | 'lavender' | 'gray';
  controls?: ReactNode;
  children: ReactNode;
  className?: string;
  titleId?: string;
  /** Heading level of the title: the main window of a screen is the page's h1. */
  level?: 1 | 2 | 3;
}) {
  const Heading = `h${level}` as const;
  return (
    <section className={`window window--${tone} ${className}`} aria-labelledby={titleId}>
      <div className="titlebar">
        {icon && <PixelIcon name={icon} />}
        <Heading className="titlebar__title" id={titleId}>
          {title}
        </Heading>
        {controls && <span className="titlebar__controls">{controls}</span>}
      </div>
      {children}
    </section>
  );
}

/** A modal window on top of a native `<dialog>`: focus is trapped and Escape closes it, for free. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  role = 'dialog',
  tone = 'lavender',
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  tone?: 'pink' | 'blue' | 'lavender';
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const closeOnBackdrop = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal--wide' : ''}`}
      role={role}
      aria-labelledby={titleId}
      onClose={() => closeRef.current()}
      onClick={closeOnBackdrop}
    >
      <div className={`window window--${tone}`}>
        <div className="titlebar">
          <h2 className="titlebar__title" id={titleId}>
            {title}
          </h2>
          <span className="titlebar__controls">
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Close"
              onClick={() => ref.current?.close()}
            >
              ×
            </button>
          </span>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </dialog>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="loader" aria-hidden="true">
        <div />
      </div>
      <p className="state__text">{label}…</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <PixelIcon name="warning" size={36} />
      <p className="state__text">{error.message || 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon = 'folder',
}: {
  title: string;
  children?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="state">
      <PixelIcon name={icon} size={40} />
      <p className="state__title">{title}</p>
      {children && <div className="state__text">{children}</div>}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: 'todo' | 'doing' | 'done' | 'late' | 'low' | 'medium' | 'high';
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div style={{ width: `${percent}%` }} />
    </div>
  );
}

/** A labelled form control; the label is tied to the control through `htmlFor`. */
export function Field({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor} className="field__label">
        {label}
      </label>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  );
}
