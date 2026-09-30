import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from './Icon';
import { PdfCanvas } from './PdfCanvas';
import { movePage } from '../lib/pageOrder';
import type { Mark, PageInfo } from '../lib/types';
import MarkGraphic from './MarkGraphic';

type Drag = {
  pointerId: number;
  page: number;
  target?: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
};

function PagePreview({
  doc,
  index,
  marks,
  info,
}: {
  doc?: PDFDocumentProxy;
  index: number;
  marks: Mark[];
  info: PageInfo;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '120px',
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return (
    <span className="editor-page-preview" ref={root}>
      {visible && doc ? (
        <span
          className="editor-thumbnail-page"
          style={{
            width: info.width * Math.min(96 / info.width, 78 / info.height),
            height: info.height * Math.min(96 / info.width, 78 / info.height),
          }}
        >
          <PdfCanvas doc={doc} index={index} width={96} />
          {marks
            .filter(
              (mark) =>
                mark.page === index &&
                !mark.deleted &&
                !['text', 'form', 'link'].includes(mark.kind),
            )
            .sort((a, b) => Number(a.kind === 'redact') - Number(b.kind === 'redact'))
            .map((mark) => (
              <svg
                key={mark.id}
                className="editor-thumbnail-marks"
                aria-hidden="true"
                viewBox={`0 0 ${info.width} ${info.height}`}
                style={mark.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
              >
                <MarkGraphic mark={mark} />
              </svg>
            ))}
        </span>
      ) : (
        <span>{index + 1}</span>
      )}
    </span>
  );
}

export default function EditorPages({
  doc,
  marks,
  pages,
  order,
  current,
  disabled,
  onSelect,
  onChange,
  onClose,
}: {
  doc?: PDFDocumentProxy;
  marks: Mark[];
  pages: PageInfo[];
  order: number[];
  current: number;
  disabled: boolean;
  onSelect: (page: number) => void;
  onChange: (order: number[]) => void;
  onClose: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = rail.current;
    const tile = container?.querySelector<HTMLElement>(`[data-editor-page="${current}"]`);
    if (!container || !tile) return;
    const bounds = tile.getBoundingClientRect(),
      viewport = container.getBoundingClientRect();
    if (bounds.top < viewport.top) container.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom)
      container.scrollTop += bounds.bottom - viewport.bottom;
  }, [current]);
  const gesture = useRef<Drag | undefined>(undefined);
  const [drag, setDrag] = useState<Drag>();
  const [announcement, setAnnouncement] = useState('');
  function targetAt(x: number, y: number) {
    const tile = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-editor-page]');
    return tile && rail.current?.contains(tile) ? Number(tile.dataset.editorPage) : undefined;
  }
  function cancel() {
    gesture.current = undefined;
    setDrag(undefined);
  }
  useEffect(() => {
    if (!drag) return;
    let frame: number;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    const scroll = () => {
      const g = gesture.current,
        element = rail.current;
      if (!g || !element) return;
      const box = element.getBoundingClientRect();
      if (g.y >= box.top && g.y <= box.bottom && g.x >= box.left && g.x <= box.right) {
        const delta =
          g.y < box.top + 44
            ? -Math.min(12, (box.top + 44 - g.y) / 3)
            : g.y > box.bottom - 44
              ? Math.min(12, (g.y - box.bottom + 44) / 3)
              : 0;
        if (delta) {
          element.scrollTop += delta;
          const target = targetAt(g.x, g.y);
          if (g.target !== target) {
            g.target = target;
            setDrag({ ...g });
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', key);
    };
  }, [!!drag]);
  useEffect(cancel, [disabled, order]);

  function start(event: PointerEvent, page: number) {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.current = {
      pointerId: event.pointerId,
      page,
      target: page,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    rail.current!.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId || disabled) return;
    g.x = event.clientX;
    g.y = event.clientY;
    if (!g.moved && Math.hypot(g.x - g.startX, g.y - g.startY) < 5) return;
    event.preventDefault();
    g.moved = true;
    g.target = targetAt(g.x, g.y);
    setDrag({ ...g });
  }
  function reorder(from: number, to: number) {
    const next = movePage(order, from, to);
    if (next === order || disabled) return;
    onChange(next);
    setAnnouncement(`Page ${from + 1} moved to position ${to + 1}.`);
  }
  function finish(event: PointerEvent) {
    const g = gesture.current;
    if (g && g.pointerId !== event.pointerId) return;
    if (g && !disabled) {
      if (!g.moved) onSelect(g.page);
      else if (g.target !== undefined) reorder(order.indexOf(g.page), order.indexOf(g.target));
    }
    cancel();
    if (rail.current?.hasPointerCapture(event.pointerId))
      rail.current.releasePointerCapture(event.pointerId);
  }
  const from = drag ? order.indexOf(drag.page) : -1,
    to = drag ? order.indexOf(drag.target ?? -1) : -1;
  return (
    <section className="editor-pages" aria-label="Page order">
      <div className="editor-panel-heading">
        <strong>Pages</strong>
        <button className="icon-button" aria-label="Close page thumbnails" onClick={onClose}>
          <Icon name="X" size={16} />
        </button>
      </div>
      <p>Drag to reorder. Use the grip on touch screens.</p>
      <div
        className="editor-pages-rail"
        ref={rail}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
      >
        {order.map((index, position) => (
          <div
            key={index}
            data-editor-page={index}
            className={`editor-page-tile ${index === current ? 'current-page' : ''} ${drag?.page === index ? 'dragged-page' : ''} ${to === position && from !== to ? (to < from ? 'drop-before' : 'drop-after') : ''}`}
          >
            <button
              className="editor-page-select"
              aria-label={`Open page ${position + 1}`}
              aria-current={index === current ? 'page' : undefined}
              disabled={disabled}
              onPointerDown={(event) => {
                if (event.pointerType === 'mouse' || event.pointerType === 'pen')
                  start(event, index);
              }}
              onClick={() => {
                if (!gesture.current) onSelect(index);
              }}
            >
              <PagePreview doc={doc} index={index} marks={marks} info={pages[index]} />
              <span>Page {position + 1}</span>
              <small>Original {index + 1}</small>
            </button>
            <div className="editor-page-actions">
              <button
                aria-label={`Move page ${position + 1} earlier`}
                disabled={disabled || position === 0}
                onClick={() => reorder(position, position - 1)}
              >
                <Icon name="ChevronUp" size={14} />
              </button>
              <button
                className="page-drag-grip"
                aria-label={`Drag page ${position + 1}`}
                title="Drag to reorder; use the adjacent buttons for keyboard movement"
                disabled={disabled}
                onPointerDown={(event) => start(event, index)}
                onClick={(event) => {
                  if (event.detail === 0) onSelect(index);
                }}
              >
                <Icon name="Grip" size={16} />
              </button>
              <button
                aria-label={`Move page ${position + 1} later`}
                disabled={disabled || position === order.length - 1}
                onClick={() => reorder(position, position + 1)}
              >
                <Icon name="ChevronDown" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {drag && (
        <div
          className="page-drag-preview"
          aria-hidden="true"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          <Icon name="Files" size={16} /> Page {from + 1}
          {to >= 0 && to !== from ? ` → ${to + 1}` : ''}
        </div>
      )}
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </section>
  );
}
