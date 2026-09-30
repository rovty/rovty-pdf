import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { nativeText } from '../lib/native';
import { inlineLayout, type InlineLayout } from '../lib/inlineLayout';
import { usesOriginalFont } from '../lib/textEdits';
import type { Mark, PageInfo } from '../lib/types';
import { hasSinhala, isIskoolaPota } from '../lib/fontLabels';

export default function InlineTextEditor({
  mark,
  renderedMark,
  bytes,
  renderReady,
  info,
  scale,
  disabled,
  error,
  onChange,
  onFinish,
  onUndo,
  onRedo,
}: {
  mark: Mark;
  renderedMark?: Mark;
  bytes?: Uint8Array;
  renderReady: boolean;
  info: PageInfo;
  scale: number;
  disabled: boolean;
  error: string;
  onChange: (text: string) => void;
  onFinish: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null),
    layer = useRef<SVGSVGElement>(null);
  const drag = useRef<number | undefined>(undefined),
    composing = useRef(false);
  const [layout, setLayout] = useState<InlineLayout>(() =>
    inlineLayout(mark.originalText ? [mark.originalText] : [], mark, info),
  );
  const [range, setRange] = useState({ start: 0, end: (mark.text || '').length }),
    [focused, setFocused] = useState(true),
    [composition, setComposition] = useState<string>();
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  useEffect(() => {
    if (!bytes || !renderReady) return;
    let active = true;
    const displayed = renderedMark || mark;
    void (
      displayed.fontFamily === 'sinhala' && !usesOriginalFont(displayed)
        ? import('../lib/sinhala').then(async ({ loadSinhalaFont, sinhalaInlineLayout }) =>
            sinhalaInlineLayout(await loadSinhalaFont(!!displayed.bold), displayed),
          )
        : nativeText(bytes, mark.page, true).then((items) => inlineLayout(items, displayed, info))
    )
      .then((next) => {
        if (active) setLayout(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [bytes, mark.page, renderedMark, info, renderReady]);
  const value = composition ?? mark.text ?? '';
  const sinhalaInput =
    mark.fontFamily === 'sinhala' ||
    hasSinhala(value) ||
    isIskoolaPota(mark.originalText?.fontName || '');
  const inputBold =
    !!mark.bold || (usesOriginalFont(mark) && /bold/i.test(mark.originalText?.fontName || ''));
  useEffect(() => {
    if (sinhalaInput)
      void import('../lib/sinhala')
        .then(({ loadSinhalaFont }) => loadSinhalaFont(inputBold))
        .catch(() => {});
  }, [sinhalaInput, inputBold]);
  const boxes = layout.boxes.filter((box) => box.end > range.start && box.start < range.end);
  const last = layout.stops.at(-1);
  const caret =
    layout.stops.find((stop) => stop.index === range.end) ||
    (last
      ? { ...last, x: last.x + Math.max(0, range.end - last.index) * mark.fontSize * 0.55 }
      : undefined);
  const bounds = layout.bounds;
  const syncSelection = () => {
    const el = input.current;
    if (el) setRange({ start: el.selectionStart, end: el.selectionEnd });
  };
  function select(start: number, end: number) {
    input.current?.setSelectionRange(
      Math.min(start, end),
      Math.max(start, end),
      end < start ? 'backward' : 'forward',
    );
    syncSelection();
  }
  function indexAt(event: { clientX: number; clientY: number }) {
    const rect = layer.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * info.width,
      y = ((event.clientY - rect.top) / rect.height) * info.height;
    return layout.stops.reduce(
      (best, stop) =>
        Math.hypot(stop.x - x, stop.y - y) < Math.hypot(best.x - x, best.y - y) ? stop : best,
      layout.stops[0],
    ).index;
  }
  function pointerDown(event: PointerEvent) {
    if (disabled || event.button !== 0 || !layout.stops.length) return;
    event.preventDefault();
    event.stopPropagation();
    input.current?.focus({ preventScroll: true });
    const index = Math.min(value.length, indexAt(event));
    if (event.detail >= 3) {
      select(0, value.length);
      return;
    }
    if (event.detail === 2) {
      let start = index,
        end = index;
      while (start > 0 && !/\s/.test(value[start - 1])) start--;
      while (end < value.length && !/\s/.test(value[end])) end++;
      select(start, end);
      return;
    }
    drag.current = event.shiftKey ? range.start : index;
    select(drag.current, index);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return (
    <>
      <textarea
        ref={input}
        className={`inline-pdf-input ${error ? 'inline-invalid' : ''} ${composition !== undefined ? 'inline-composing' : ''}`}
        aria-label="Edit text on page"
        aria-multiline={!usesOriginalFont(mark)}
        aria-invalid={!!error}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        value={value}
        disabled={disabled}
        style={{
          left: bounds.x * scale,
          top: bounds.y * scale,
          width: bounds.width * scale,
          height: bounds.height * scale,
          fontSize: mark.fontSize * scale,
          ...(sinhalaInput
            ? { fontFamily: '"Noto Sinhala", serif', fontWeight: inputBold ? 700 : 400 }
            : {}),
          lineHeight: 1.2,
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={syncSelection}
        onPointerDown={pointerDown}
        onPointerMove={(event) => {
          if (drag.current !== undefined) {
            event.preventDefault();
            select(drag.current, Math.min(value.length, indexAt(event)));
          }
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        onDoubleClick={(event) => {
          if (!layout.stops.length) return;
          event.preventDefault();
          let start = Math.min(value.length, indexAt(event)),
            end = start;
          while (start > 0 && !/\s/.test(value[start - 1])) start--;
          while (end < value.length && !/\s/.test(value[end])) end++;
          select(start, end);
        }}
        onCompositionStart={() => {
          composing.current = true;
          setComposition(mark.text || '');
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setComposition(undefined);
          onChange(
            usesOriginalFont(mark)
              ? event.currentTarget.value.replace(/[\r\n]+/g, ' ')
              : event.currentTarget.value,
          );
        }}
        onChange={(event) => {
          if (composing.current) setComposition(event.target.value);
          else
            onChange(
              usesOriginalFont(mark)
                ? event.target.value.replace(/[\r\n]+/g, ' ')
                : event.target.value,
            );
          syncSelection();
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composing.current) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            event.shiftKey ? onRedo() : onUndo();
          } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
            event.preventDefault();
            onRedo();
          } else if (
            event.key === 'Escape' ||
            (event.key === 'Enter' && (usesOriginalFont(mark) || !event.shiftKey))
          ) {
            event.preventDefault();
            onFinish();
          }
        }}
      />
      <svg
        ref={layer}
        className="inline-cursor-layer"
        viewBox={`0 0 ${info.width} ${info.height}`}
        aria-hidden="true"
        data-exact-layout={layout.exact}
      >
        <rect
          className="selection-outline"
          x={bounds.x - 0.5}
          y={bounds.y - 0.5}
          width={bounds.width + 1}
          height={bounds.height + 1}
          vectorEffect="non-scaling-stroke"
        />
        {focused &&
          !error &&
          composition === undefined &&
          boxes.map((box, index) => (
            <rect
              key={index}
              className="inline-text-selection"
              x={box.x - 0.5}
              y={box.y - 1}
              width={box.width + 1}
              height={box.height + 2}
            />
          ))}
        {focused && range.start === range.end && caret && !error && composition === undefined && (
          <line
            className="inline-text-caret"
            x1={caret.x - caret.nx * caret.ascent}
            y1={caret.y - caret.ny * caret.ascent}
            x2={caret.x + caret.nx * caret.descent}
            y2={caret.y + caret.ny * caret.descent}
            strokeWidth={1.5 / scale}
          />
        )}
      </svg>
    </>
  );
}
