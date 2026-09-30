import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../Icon';

export default function ScanSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      element.close();
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected && !document.querySelector('dialog[open]'))
          previousFocus.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="scan-sheet"
      aria-labelledby="scan-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header>
        <h2 id="scan-sheet-title">{title}</h2>
        <button
          className="icon-button"
          aria-label={`Close ${title.toLowerCase()}`}
          onClick={onClose}
        >
          <Icon name="X" />
        </button>
      </header>
      <div className="scan-sheet-content">{children}</div>
    </dialog>
  );
}
