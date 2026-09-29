import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from './Icon';
import SignatureDialog from './SignatureDialog';
import { PdfCanvas } from './PdfCanvas';
import { openPdf } from '../lib/pdf';
import { nativeText } from '../lib/native';
import { applyTextEdits, usesOriginalFont } from '../lib/textEdits';
import { readFields, previewFields } from '../lib/operations';
import { clamp, humanError, transformPoint } from '../lib/utils';
import {
  uid,
  type EditState,
  type FormField,
  type Mark,
  type MarkKind,
  type NativeText,
  type SourceFile,
  type ToolId,
} from '../lib/types';

type Mode = MarkKind | 'select' | 'existing';
type Gesture = {
  type: 'move' | 'resize' | 'draw';
  start: [number, number];
  original: Mark;
  points?: number[][];
};
interface Props {
  source: SourceFile;
  value: EditState;
  onChange: (value: EditState) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  mode: ToolId;
  disabled: boolean;
  onError: (value: string) => void;
  flatten: boolean;
  setFlatten: (value: boolean) => void;
}
const toolbar: { id: Mode; name: string; icon: string }[] = [
  { id: 'select', name: 'Select', icon: 'MousePointer2' },
  { id: 'existing', name: 'Edit text', icon: 'TextCursorInput' },
  { id: 'text', name: 'Add text', icon: 'Type' },
  { id: 'highlight', name: 'Highlight', icon: 'Highlighter' },
  { id: 'cover', name: 'Cover', icon: 'Eraser' },
  { id: 'pen', name: 'Draw', icon: 'Pencil' },
  { id: 'rectangle', name: 'Rectangle', icon: 'Square' },
  { id: 'ellipse', name: 'Ellipse', icon: 'Circle' },
  { id: 'line', name: 'Line', icon: 'Minus' },
  { id: 'link', name: 'Link', icon: 'Link' },
  { id: 'redact', name: 'Redact', icon: 'ScanLine' },
];
const hints: Record<Mode, string> = {
  select: 'Select an addition to move, resize or change it.',
  existing: 'Click a text block to edit it using its original PDF font and positioning.',
  text: 'Click the page to add a text box.',
  highlight: 'Drag across the area you want to highlight.',
  cover: 'Drag to cover an area visually. For permanent removal, use Redact.',
  pen: 'Draw on the page with your mouse, pen or finger.',
  rectangle: 'Drag to draw a rectangle.',
  ellipse: 'Drag to draw an ellipse.',
  line: 'Drag to draw a line.',
  image: 'Move or resize the image on the page.',
  link: 'Drag over an area, then enter its destination URL.',
  redact: 'Drag over sensitive content. Export permanently removes it and flattens the PDF.',
};

export default function Editor({
  source,
  value,
  onChange,
  undo,
  redo,
  canUndo,
  canRedo,
  mode,
  disabled,
  onError,
  flatten,
  setFlatten,
}: Props) {
  const [page, setPage] = useState(0),
    [tool, setTool] = useState<Mode>(
      mode === 'redact' ? 'redact' : mode === 'edit' ? 'existing' : 'select',
    );
  const [selected, setSelected] = useState<string>(),
    [draft, setDraft] = useState<Mark>(),
    [doc, setDoc] = useState<PDFDocumentProxy>();
  const [previewLoading, setPreviewLoading] = useState(true);
  const [textEditError, setTextEditError] = useState('');
  const [texts, setTexts] = useState<NativeText[]>([]),
    [textLoading, setTextLoading] = useState(false),
    [fields, setFields] = useState<FormField[]>([]),
    [fieldError, setFieldError] = useState('');
  const [signature, setSignature] = useState(false),
    [tab, setTab] = useState<'properties' | 'forms'>(mode === 'fill' ? 'forms' : 'properties');
  const [ink, setInk] = useState('#171719'),
    [size, setSize] = useState(18),
    [zoom, setZoom] = useState(1),
    [availableWidth, setAvailableWidth] = useState(760);
  const svg = useRef<SVGSVGElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | undefined>(undefined),
    latest = useRef<Mark | undefined>(undefined),
    imageInput = useRef<HTMLInputElement>(null),
    textInput = useRef<HTMLTextAreaElement>(null);
  const info = source.pages[page],
    current = value.marks.find((mark) => mark.id === selected),
    marks = value.marks.filter((mark) => mark.page === page);
  const textEditKey = JSON.stringify(value.marks.filter((mark) => mark.sourcePath));
  const fieldsKey = JSON.stringify(value.fields);
  useEffect(() => {
    let active = true,
      loaded: PDFDocumentProxy | undefined;
    setPreviewLoading(true);
    setTextEditError('');
    const timer = window.setTimeout(
      () =>
        void (async () => {
          try {
            let bytes = await applyTextEdits(source, value.marks);
            bytes = await previewFields(bytes, value.fields);
            loaded = await openPdf(bytes);
            if (active) setDoc(loaded);
            else await loaded.loadingTask.destroy();
          } catch (e) {
            if (active) setTextEditError(humanError(e));
          } finally {
            if (active) setPreviewLoading(false);
          }
        })(),
      textEditKey === '[]' ? 0 : 180,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
      void loaded?.loadingTask.destroy();
    };
  }, [source, textEditKey, fieldsKey]); // Preview the actual edited PDF using the same font path as export.
  useEffect(() => {
    let active = true;
    void readFields(source.bytes)
      .then((result) => {
        if (active) setFields(result);
      })
      .catch((e) => {
        if (active) setFieldError(humanError(e));
      });
    return () => {
      active = false;
    };
  }, [source]);
  useEffect(() => {
    if (tool !== 'existing') return;
    let active = true;
    setTextLoading(true);
    setTexts([]);
    void nativeText(source.bytes, page)
      .then((result) => {
        if (active) setTexts(result);
      })
      .catch((e) => {
        if (active) onError(humanError(e));
      })
      .finally(() => {
        if (active) setTextLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source, page, tool, onError]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver((entries) =>
      setAvailableWidth(entries[0].contentRect.width),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (current?.kind === 'text') {
      textInput.current?.focus();
      textInput.current?.select();
    }
  }, [selected]);
  const remove = useCallback(() => {
    if (selected && !disabled) {
      onChange({ ...value, marks: value.marks.filter((mark) => mark.id !== selected) });
      setSelected(undefined);
    }
  }, [selected, disabled, onChange, value]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (disabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selected) {
          event.preventDefault();
          remove();
        }
      } else if (event.key === 'Escape') {
        setSelected(undefined);
        setDraft(undefined);
        gesture.current = undefined;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, undo, redo, remove, disabled]);
  const commitMark = (mark: Mark) => {
    onChange({
      ...value,
      marks: value.marks.some((item) => item.id === mark.id)
        ? value.marks.map((item) => (item.id === mark.id ? mark : item))
        : [...value.marks, mark],
    });
    setSelected(mark.id);
    setTab('properties');
  };
  const update = (patch: Partial<Mark>) => {
    if (current && !disabled) commitMark({ ...current, ...patch });
  };
  function coordinates(event: ReactPointerEvent): [number, number] {
    const rect = svg.current!.getBoundingClientRect();
    return [
      clamp(((event.clientX - rect.left) / rect.width) * info.width, 0, info.width),
      clamp(((event.clientY - rect.top) / rect.height) * info.height, 0, info.height),
    ];
  }
  function newMark(kind: MarkKind, x: number, y: number): Mark {
    return {
      id: uid(),
      page,
      kind,
      x,
      y,
      width: Math.min(210, info.width - x),
      height: size * 1.5,
      color:
        kind === 'highlight'
          ? '#f5cf4b'
          : kind === 'redact'
            ? '#000000'
            : kind === 'cover'
              ? '#ffffff'
              : ink,
      fontSize: size,
      strokeWidth: 2,
      opacity: kind === 'highlight' ? 0.4 : 1,
      ...(kind === 'text' ? { text: 'Type your text' } : {}),
      ...(kind === 'link' ? { url: 'https://' } : {}),
    };
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0) return;
    const point = coordinates(event);
    if (tool === 'select' || tool === 'existing') {
      setSelected(undefined);
      return;
    }
    if (tool === 'text') {
      commitMark(newMark('text', ...point));
      setTool('select');
      return;
    }
    if (tool === 'image') return;
    event.preventDefault();
    svg.current!.setPointerCapture(event.pointerId);
    const mark = newMark(tool, ...point);
    gesture.current = { type: 'draw', start: point, original: mark, points: [point] };
    latest.current = mark;
    setDraft(mark);
    setSelected(undefined);
  }
  function startObject(event: ReactPointerEvent, mark: Mark, resize = false) {
    if (disabled) return;
    event.stopPropagation();
    event.preventDefault();
    setSelected(mark.id);
    setTab('properties');
    setTool('select');
    svg.current!.setPointerCapture(event.pointerId);
    gesture.current = {
      type: resize ? 'resize' : 'move',
      start: coordinates(event),
      original: mark,
    };
    latest.current = mark;
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || disabled) return;
    event.preventDefault();
    const point = coordinates(event),
      [dx, dy] = [point[0] - g.start[0], point[1] - g.start[1]];
    let next: Mark;
    if (g.type === 'move')
      next = {
        ...g.original,
        x: clamp(g.original.x + dx, 0, Math.max(0, info.width - g.original.width)),
        y: clamp(g.original.y + dy, 0, Math.max(0, info.height - g.original.height)),
      };
    else if (g.type === 'resize') {
      const width = clamp(g.original.width + dx, 8, info.width - g.original.x),
        height =
          g.original.kind === 'image'
            ? (width * g.original.height) / g.original.width
            : clamp(g.original.height + dy, 8, info.height - g.original.y);
      next = { ...g.original, width, height: Math.min(height, info.height - g.original.y) };
      if (g.original.points)
        next.points = g.original.points.map((pt) => [
          (pt[0] * width) / g.original.width,
          (pt[1] * height) / g.original.height,
        ]);
    } else {
      if (g.original.kind === 'pen') g.points!.push(point);
      const points = g.original.kind === 'pen' ? g.points! : [g.start, point],
        xs = points.map((p) => p[0]),
        ys = points.map((p) => p[1]),
        x = Math.min(...xs),
        y = Math.min(...ys);
      next = {
        ...g.original,
        x,
        y,
        width: Math.max(1, Math.max(...xs) - x),
        height: Math.max(1, Math.max(...ys) - y),
        ...(['pen', 'line'].includes(g.original.kind)
          ? { points: points.map((pt) => [pt[0] - x, pt[1] - y]) }
          : {}),
      };
    }
    latest.current = next;
    setDraft(next);
  }
  function finish() {
    const g = gesture.current,
      mark = latest.current;
    gesture.current = undefined;
    latest.current = undefined;
    setDraft(undefined);
    if (g && mark) {
      if (g.type === 'draw' && mark.width < 3 && mark.height < 3) return;
      if (JSON.stringify(mark) !== JSON.stringify(g.original) || g.type === 'draw')
        commitMark(mark);
      setTool('select');
    }
  }
  function existing(item: NativeText) {
    if (disabled) return;
    const a = transformPoint(info.transform, item.bounds[0], item.bounds[1]),
      b = transformPoint(info.transform, item.bounds[2], item.bounds[3]);
    const mark = {
      ...newMark('text', Math.min(a[0], b[0]), Math.min(a[1], b[1])),
      width: Math.abs(b[0] - a[0]) + 12,
      height: Math.max(item.size * 1.3, Math.abs(b[1] - a[1])),
      fontSize: item.size || 16,
      text: item.text,
      color: item.color,
      opacity: item.opacity,
      sourcePath: item.path,
      originalText: item,
      sourceOrigin: [Math.min(a[0], b[0]), Math.min(a[1], b[1])] as [number, number],
      fontMode: 'original' as const,
    };
    commitMark(mark);
    setTool('select');
  }
  function placeImage(dataUrl: string, width: number, height: number) {
    const scale = Math.min(220 / width, (info.width * 0.6) / width, (info.height * 0.6) / height),
      w = width * scale,
      h = height * scale;
    const mark = {
      ...newMark('image', Math.max(0, (info.width - w) / 2), Math.max(0, (info.height - h) / 2)),
      width: w,
      height: h,
      dataUrl,
    };
    commitMark(mark);
    setTool('select');
  }
  async function imageFile(file?: File) {
    if (!file) return;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type))
        throw new Error('Choose a PNG, JPG or WebP image.');
      if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 25_000_000) {
        bitmap.close();
        throw new Error('Resize this image to under 25 megapixels.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      placeImage(canvas.toDataURL('image/png'), canvas.width, canvas.height);
      canvas.width = canvas.height = 1;
    } catch (e) {
      onError(humanError(e));
    } finally {
      if (imageInput.current) imageInput.current.value = '';
    }
  }
  const shown = draft ? [...marks.filter((mark) => mark.id !== draft.id), draft] : marks;
  const stageWidth = Math.max(180, Math.min(info.width, availableWidth - 56)) * zoom;
  return (
    <div className={`pdf-editor ${disabled ? 'editor-busy' : ''}`} aria-busy={previewLoading}>
      <input
        ref={imageInput}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Add image to PDF"
        onChange={(e) => void imageFile(e.target.files?.[0])}
      />
      <div className="editor-toolbar" role="toolbar" aria-label="PDF editing tools">
        <div className="editor-tool-group">
          {toolbar.map((item) => (
            <button
              key={item.id}
              className={tool === item.id ? 'active' : ''}
              aria-pressed={tool === item.id}
              disabled={disabled}
              onClick={() => {
                setTool(item.id);
                setSelected(undefined);
              }}
              title={item.name}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.name}</span>
            </button>
          ))}
          <button onClick={() => imageInput.current?.click()} disabled={disabled}>
            <Icon name="ImagePlus" size={17} />
            <span>Image</span>
          </button>
          <button onClick={() => setSignature(true)} disabled={disabled}>
            <Icon name="Signature" size={18} />
            <span>Signature</span>
          </button>
        </div>
        <div className="undo-tools">
          <button
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            disabled={!canUndo || disabled}
            onClick={undo}
          >
            <Icon name="Undo2" size={17} />
          </button>
          <button
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            disabled={!canRedo || disabled}
            onClick={redo}
          >
            <Icon name="Redo2" size={17} />
          </button>
        </div>
      </div>
      <div className="editor-body">
        <div className="editor-document">
          <div className={`editor-hint ${tool === 'redact' ? 'redact-hint' : ''}`}>
            <Icon name={tool === 'redact' ? 'ShieldCheck' : 'Info'} size={15} />
            {textLoading ? 'Finding editable text…' : hints[tool]}
          </div>
          <div className="editor-viewport" ref={viewport}>
            <div
              className={`page-stage mode-${tool}`}
              style={{ width: stageWidth, aspectRatio: `${info.width}/${info.height}` }}
            >
              {doc ? (
                <PdfCanvas doc={doc} index={page} width={stageWidth} onError={onError} />
              ) : (
                <div className="page-loading">
                  <span className="spinner" />
                </div>
              )}
              <svg
                ref={svg}
                className="annotation-layer"
                viewBox={`0 0 ${info.width} ${info.height}`}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={finish}
                onPointerCancel={() => {
                  gesture.current = undefined;
                  setDraft(undefined);
                }}
                aria-label={`Editable PDF page ${page + 1}`}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (
                    !current ||
                    disabled ||
                    !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const distance = event.shiftKey ? 10 : 1;
                  update({
                    x: clamp(
                      current.x +
                        (event.key === 'ArrowLeft'
                          ? -distance
                          : event.key === 'ArrowRight'
                            ? distance
                            : 0),
                      0,
                      info.width - current.width,
                    ),
                    y: clamp(
                      current.y +
                        (event.key === 'ArrowUp'
                          ? -distance
                          : event.key === 'ArrowDown'
                            ? distance
                            : 0),
                      0,
                      info.height - current.height,
                    ),
                  });
                }}
              >
                {tool === 'existing' &&
                  texts
                    .filter(
                      (item) =>
                        !value.marks.some(
                          (mark) =>
                            mark.page === page &&
                            mark.sourcePath?.join('.') === item.path.join('.'),
                        ),
                    )
                    .map((item) => {
                      const a = transformPoint(info.transform, item.bounds[0], item.bounds[1]),
                        b = transformPoint(info.transform, item.bounds[2], item.bounds[3]);
                      return (
                        <rect
                          key={item.path.join('.')}
                          className="native-text-target"
                          role="button"
                          tabIndex={disabled ? -1 : 0}
                          aria-label={`Edit: ${item.text}`}
                          x={Math.min(a[0], b[0]) - 2}
                          y={Math.min(a[1], b[1]) - 2}
                          width={Math.max(8, Math.abs(b[0] - a[0]) + 4)}
                          height={Math.max(12, Math.abs(b[1] - a[1]) + 4)}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            existing(item);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              existing(item);
                            }
                          }}
                        >
                          <title>Edit: {item.text}</title>
                        </rect>
                      );
                    })}
                {shown.map((mark) => (
                  <g
                    key={mark.id}
                    className="annotation"
                    onPointerDown={(e) => startObject(e, mark)}
                  >
                    {!usesOriginalFont(mark) && <MarkGraphic mark={mark} />}
                    <rect
                      className="annotation-hit"
                      x={mark.x}
                      y={mark.y}
                      width={Math.max(8, mark.width)}
                      height={Math.max(8, mark.height)}
                    />
                    {selected === mark.id && (
                      <>
                        <rect
                          className="selection-outline"
                          x={mark.x - 2}
                          y={mark.y - 2}
                          width={mark.width + 4}
                          height={mark.height + 4}
                        />
                        <rect
                          className="resize-handle"
                          x={mark.x + mark.width - 5}
                          y={mark.y + mark.height - 5}
                          width={10}
                          height={10}
                          onPointerDown={(e) => startObject(e, mark, true)}
                        />
                      </>
                    )}
                  </g>
                ))}
              </svg>
            </div>
          </div>
          <div className="editor-pagebar">
            <div>
              <button
                className="icon-button"
                aria-label="Previous page"
                disabled={page === 0 || disabled}
                onClick={() => {
                  setPage(page - 1);
                  setSelected(undefined);
                }}
              >
                <Icon name="ChevronLeft" size={19} />
              </button>
              <label>
                Page{' '}
                <input
                  aria-label="Current page"
                  type="number"
                  min={1}
                  max={source.pages.length}
                  value={page + 1}
                  onChange={(e) => {
                    setPage(clamp(Number(e.target.value) - 1, 0, source.pages.length - 1));
                    setSelected(undefined);
                  }}
                />{' '}
                of {source.pages.length}
              </label>
              <button
                className="icon-button"
                aria-label="Next page"
                disabled={page === source.pages.length - 1 || disabled}
                onClick={() => {
                  setPage(page + 1);
                  setSelected(undefined);
                }}
              >
                <Icon name="ChevronRight" size={19} />
              </button>
            </div>
            <div>
              <button
                className="icon-button"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
              >
                <Icon name="Minus" size={16} />
              </button>
              <button className="zoom-reset" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                disabled={zoom >= 2}
                onClick={() => setZoom(Math.min(2, zoom + 0.25))}
              >
                <Icon name="Plus" size={16} />
              </button>
            </div>
          </div>
        </div>
        <aside className="editor-inspector">
          <div className="inspector-tabs">
            <button aria-pressed={tab === 'properties'} onClick={() => setTab('properties')}>
              Edit
            </button>
            <button aria-pressed={tab === 'forms'} onClick={() => setTab('forms')}>
              Form fields <span>{fields.length}</span>
            </button>
          </div>
          <fieldset disabled={disabled}>
            {tab === 'forms' ? (
              <div className="form-fields">
                <h2>Fill in the details.</h2>
                {fieldError && <p role="alert">{fieldError}</p>}
                {!fields.length ? (
                  <>
                    <p>No interactive fields were found. Add text to fill in a flat form.</p>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setTool('text');
                        setTab('properties');
                      }}
                    >
                      Add text to the page
                    </button>
                  </>
                ) : (
                  fields.map((field) => {
                    const val = value.fields[field.name] ?? field.value;
                    const set = (v: string | boolean | string[]) =>
                      onChange({ ...value, fields: { ...value.fields, [field.name]: v } });
                    return field.type === 'checkbox' ? (
                      <label className="checkbox-field" key={field.name}>
                        <input
                          type="checkbox"
                          checked={Boolean(val)}
                          disabled={field.readOnly}
                          onChange={(e) => set(e.target.checked)}
                        />
                        {field.name}
                      </label>
                    ) : (
                      <label className="field" key={field.name}>
                        {field.name}
                        {field.type === 'text' ? (
                          <input
                            value={String(val)}
                            disabled={field.readOnly}
                            onChange={(e) => set(e.target.value)}
                          />
                        ) : (
                          <select
                            value={Array.isArray(val) ? val[0] || '' : String(val)}
                            disabled={field.readOnly}
                            onChange={(e) => set(e.target.value)}
                          >
                            <option value="">Choose…</option>
                            {field.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    );
                  })
                )}
                <label className="checkbox-field flatten-control">
                  <input
                    type="checkbox"
                    checked={flatten}
                    onChange={(e) => setFlatten(e.target.checked)}
                  />
                  Flatten form fields when saving
                </label>
                <p className="inspector-note">
                  Flattening keeps field values visible but removes form interactivity.
                </p>
              </div>
            ) : current ? (
              <div className="properties">
                <div className="properties-heading">
                  <h2>
                    {current.sourcePath
                      ? 'Edit existing text'
                      : current.kind === 'image'
                        ? 'Image / signature'
                        : current.kind.charAt(0).toUpperCase() + current.kind.slice(1)}
                  </h2>
                  <button
                    className="icon-button danger"
                    aria-label="Delete selected addition"
                    onClick={remove}
                  >
                    <Icon name="Trash2" size={17} />
                  </button>
                </div>
                {current.kind === 'text' && (
                  <>
                    {current.originalText && (
                      <>
                        <label className="field">
                          Text font
                          <select
                            value={current.fontMode || 'original'}
                            onChange={(e) =>
                              update({ fontMode: e.target.value as 'original' | 'noto' })
                            }
                          >
                            <option value="original">
                              Original · {current.originalText.fontName}
                            </option>
                            <option value="noto">Noto Sans · change font</option>
                          </select>
                        </label>
                        <p className="inspector-note" data-testid="matched-font">
                          {usesOriginalFont(current)
                            ? `${current.originalText.fontName} · ${current.originalText.fontEmbedded ? 'Embedded in this PDF' : 'Original PDF font reference'}. Font style and baseline are preserved. Longer text may need more room.`
                            : 'Noto Sans replaces the original typeface for this block.'}
                        </p>
                      </>
                    )}
                    <label className="field">
                      Text
                      <textarea
                        ref={textInput}
                        value={current.text || ''}
                        rows={5}
                        onChange={(e) =>
                          update({
                            text: e.target.value,
                            height: Math.max(
                              current.height,
                              e.target.value.split('\n').length * current.fontSize * 1.2,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      Font size
                      <input
                        type="number"
                        value={current.fontSize}
                        min={6}
                        max={150}
                        onChange={(e) =>
                          update({ fontSize: clamp(Number(e.target.value) || 6, 6, 150) })
                        }
                      />
                    </label>
                    {!usesOriginalFont(current) && (
                      <p className="inspector-note">
                        Noto Sans · supports Latin, Greek and Cyrillic text. Original text is
                        removed when replacing an editable block.
                      </p>
                    )}
                    {textEditError && (
                      <p className="text-edit-error" role="alert">
                        {textEditError}
                      </p>
                    )}
                  </>
                )}
                {current.kind === 'link' && (
                  <label className="field">
                    Destination URL
                    <input
                      type="url"
                      placeholder="https://example.com"
                      value={current.url || ''}
                      onChange={(e) => update({ url: e.target.value })}
                    />
                  </label>
                )}
                {!['image', 'cover', 'redact', 'link'].includes(current.kind) && (
                  <label className="field color-field">
                    Color
                    <input
                      type="color"
                      value={current.color}
                      onChange={(e) => update({ color: e.target.value })}
                    />
                  </label>
                )}
                {['pen', 'line', 'rectangle', 'ellipse'].includes(current.kind) && (
                  <label className="field">
                    Stroke width
                    <input
                      type="range"
                      min={1}
                      max={12}
                      value={current.strokeWidth}
                      onChange={(e) => update({ strokeWidth: Number(e.target.value) })}
                    />
                  </label>
                )}
                {!['redact', 'cover', 'link'].includes(current.kind) && (
                  <label className="field">
                    Opacity{' '}
                    <span className="field-value">{Math.round(current.opacity * 100)}%</span>
                    <input
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={current.opacity}
                      onChange={(e) => update({ opacity: Number(e.target.value) })}
                    />
                  </label>
                )}
                <div className="property-grid">
                  <label className="field">
                    X
                    <input
                      type="number"
                      min={0}
                      max={info.width}
                      value={Math.round(current.x)}
                      onChange={(e) =>
                        update({ x: clamp(Number(e.target.value), 0, info.width - current.width) })
                      }
                    />
                  </label>
                  <label className="field">
                    Y
                    <input
                      type="number"
                      min={0}
                      max={info.height}
                      value={Math.round(current.y)}
                      onChange={(e) =>
                        update({
                          y: clamp(Number(e.target.value), 0, info.height - current.height),
                        })
                      }
                    />
                  </label>
                </div>
                <p className="inspector-note">
                  Drag to move. Use the corner handle to resize. Arrow keys move the selected
                  addition.
                </p>
                {current.kind === 'redact' && (
                  <div className="redaction-note">
                    <Icon name="ShieldCheck" size={20} />
                    <p>
                      On export, selected content is permanently removed. All pages become images.
                    </p>
                  </div>
                )}
                {current.kind === 'cover' && (
                  <p className="inspector-note">
                    This is a visual cover. Underlying content remains in the PDF. Use Redact for
                    private information.
                  </p>
                )}
              </div>
            ) : (
              <div className="inspector-empty">
                <div className={`tool-icon ${mode === 'redact' ? 'coral' : 'yellow'}`}>
                  <Icon
                    name={
                      mode === 'sign'
                        ? 'Signature'
                        : mode === 'redact'
                          ? 'ScanLine'
                          : 'MousePointer2'
                    }
                    size={25}
                  />
                </div>
                <h2>
                  {mode === 'sign'
                    ? 'Make your mark.'
                    : mode === 'redact'
                      ? 'Keep it private.'
                      : 'A little change goes a long way.'}
                </h2>
                <p>{hints[tool]}</p>
                {tool === 'existing' && !textLoading && texts.length === 0 && (
                  <p>
                    No editable text blocks were found on this page. You can still add text or draw
                    on it.
                  </p>
                )}
                <div className="quick-editor-actions">
                  <button className="button secondary" onClick={() => setTool('text')}>
                    <Icon name="Type" size={16} />
                    Add text
                  </button>
                  <button className="button secondary" onClick={() => setSignature(true)}>
                    <Icon name="Signature" size={16} />
                    Add signature
                  </button>
                </div>
                <label className="field color-field">
                  Default color
                  <input type="color" value={ink} onChange={(e) => setInk(e.target.value)} />
                </label>
                <label className="field">
                  Default text size
                  <input
                    type="number"
                    min={6}
                    max={150}
                    value={size}
                    onChange={(e) => setSize(clamp(Number(e.target.value) || 18, 6, 150))}
                  />
                </label>
              </div>
            )}
          </fieldset>
          {textEditError && current?.kind !== 'text' && (
            <p className="text-edit-error" role="alert">
              {textEditError}
            </p>
          )}
          <div className="editor-change-count">
            <span className="green-light" />
            {value.marks.length} {value.marks.length === 1 ? 'addition' : 'additions'} · Original
            kept safe
          </div>
        </aside>
      </div>
      {signature && (
        <SignatureDialog
          onClose={() => setSignature(false)}
          onSave={(url, width, height) => {
            placeImage(url, width, height);
            setSignature(false);
          }}
        />
      )}
    </div>
  );
}

function MarkGraphic({ mark: m }: { mark: Mark }) {
  if (m.kind === 'text')
    return (
      <text
        x={m.x}
        y={m.y + m.fontSize * 0.9}
        fill={m.color}
        opacity={m.opacity}
        fontSize={m.fontSize}
        fontFamily="Noto PDF"
      >
        <tspan>{(m.text || '').split('\n')[0]}</tspan>
        {(m.text || '')
          .split('\n')
          .slice(1)
          .map((line, i) => (
            <tspan key={i} x={m.x} dy={m.fontSize * 1.2}>
              {line}
            </tspan>
          ))}
      </text>
    );
  if (m.kind === 'image')
    return (
      <image
        href={m.dataUrl}
        x={m.x}
        y={m.y}
        width={m.width}
        height={m.height}
        opacity={m.opacity}
        preserveAspectRatio="none"
      />
    );
  if (m.kind === 'pen' || m.kind === 'line')
    return (
      <polyline
        points={(
          m.points || [
            [0, 0],
            [m.width, m.height],
          ]
        )
          .map((pt) => `${m.x + pt[0]},${m.y + pt[1]}`)
          .join(' ')}
        fill="none"
        stroke={m.color}
        strokeWidth={m.strokeWidth}
        opacity={m.opacity}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (m.kind === 'ellipse')
    return (
      <ellipse
        cx={m.x + m.width / 2}
        cy={m.y + m.height / 2}
        rx={m.width / 2}
        ry={m.height / 2}
        fill="none"
        stroke={m.color}
        strokeWidth={m.strokeWidth}
        opacity={m.opacity}
      />
    );
  return (
    <rect
      x={m.x}
      y={m.y}
      width={m.width}
      height={m.height}
      fill={
        m.kind === 'rectangle'
          ? 'none'
          : m.kind === 'cover'
            ? '#fff'
            : m.kind === 'redact'
              ? '#000'
              : m.kind === 'link'
                ? '#668bc72b'
                : m.color
      }
      opacity={m.kind === 'redact' || m.kind === 'cover' ? 1 : m.opacity}
      stroke={m.kind === 'rectangle' ? m.color : m.kind === 'link' ? '#4c76a8' : 'none'}
      strokeWidth={m.strokeWidth}
      style={m.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
}
