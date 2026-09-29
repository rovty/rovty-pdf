import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** Keep editing state in Editor while placing its controls in the document header. */
export default function EditorToolbar({
  target,
  children,
  history,
}: {
  target: HTMLElement | null;
  children: ReactNode;
  history: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => {
      const start = element.scrollLeft <= 1;
      const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
      setEdges((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end },
      );
    };
    const resize = new ResizeObserver(update);
    resize.observe(element);
    for (const child of element.children) resize.observe(child);
    element.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      resize.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [target]);
  function scroll(direction: number) {
    const element = rail.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(120, element.clientWidth * 0.75),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
  if (!target) return null;
  return createPortal(
    <div
      className="editor-toolbar header-editor-toolbar"
      role="toolbar"
      aria-label="PDF editing tools"
      aria-orientation="horizontal"
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).matches('select') ||
          !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        )
          return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            '.editor-tool-group button:not(:disabled), .editor-tool-group select:not(:disabled), .undo-tools button:not(:disabled)',
          ),
        );
        const index = controls.indexOf(event.target as HTMLElement);
        if (index < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? controls.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
        controls[next]?.focus();
      }}
    >
      <button
        className="toolbar-scroll"
        aria-label="Previous tools"
        title="Previous tools"
        disabled={edges.start}
        onClick={() => scroll(-1)}
      >
        <Icon name="ChevronLeft" size={16} />
      </button>
      <div className="editor-tool-group" ref={rail}>
        {children}
      </div>
      <button
        className="toolbar-scroll"
        aria-label="More tools"
        title="More tools"
        disabled={edges.end}
        onClick={() => scroll(1)}
      >
        <Icon name="ChevronRight" size={16} />
      </button>
      <div className="undo-tools">{history}</div>
    </div>,
    target,
  );
}
