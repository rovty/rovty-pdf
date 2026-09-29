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
import FindReplace from './FindReplace';
import OnPageFields from './OnPageFields';
import { PdfCanvas } from './PdfCanvas';
import { openPdf } from '../lib/pdf';
import { nativeText } from '../lib/native';
import { usesOriginalFont } from '../lib/textEdits';
import { markFromText, readLinks } from '../lib/editorObjects';
import { groupTextLines, textSources } from '../lib/textBlocks';
import { readFields, previewEditor } from '../lib/operations';
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

type Mode = MarkKind | 'select' | 'existing' | 'strike' | 'underline';
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
  { id: 'strike', name: 'Strikethrough', icon: 'Strikethrough' },
  { id: 'underline', name: 'Underline', icon: 'Underline' },
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
  existing: 'Click a line to edit with its original font, or click empty space to add text.',
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
  form: 'Drag to place a fillable field, then set its name and default value.',
  strike: 'Click a text line to strike it through, or drag to draw a strike.',
  underline: 'Click a text line to underline it, or drag to draw an underline.',
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
  const [findOpen, setFindOpen] = useState(false),
    [links, setLinks] = useState<Mark[]>([]);
  const [formType, setFormType] = useState<Mark['formType']>('text');
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
    marks = value.marks.filter((mark) => mark.page === page && !mark.deleted);
  const textEditKey = JSON.stringify(
    value.marks.filter((mark) => mark.kind === 'text' || mark.kind === 'form'),
  );
  const fieldsKey = JSON.stringify(value.fields);
  const editedPaths = new Set(
    marks.flatMap((mark) =>
      mark.originalText ? textSources(mark.originalText).map((item) => item.path.join('.')) : [],
    ),
  );
  const textBlocks = groupTextLines(texts.filter((item) => !editedPaths.has(item.path.join('.'))));
  const addedFields = value.marks.filter((mark) => mark.kind === 'form' && !mark.deleted);
  const addedFieldNames = new Set(
    addedFields.map((mark) => mark.fieldName?.trim()).filter(Boolean),
  );
  useEffect(
    () => () => {
      void doc?.loadingTask.destroy();
    },
    [doc],
  );
  useEffect(() => {
    let active = true;
    setPreviewLoading(true);
    setTextEditError('');
    const timer = window.setTimeout(
      () =>
        void (async () => {
          try {
            const bytes = await previewEditor(source, value);
            const loaded = await openPdf(bytes);
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
    let active = true;
    void readLinks(source)
      .then((result) => {
        if (active) setLinks(result);
      })
      .catch((e) => {
        if (active) onError(humanError(e));
      });
    return () => {
      active = false;
    };
  }, [source, onError]);
  useEffect(() => {
    if (!['existing', 'text', 'highlight', 'strike', 'underline'].includes(tool)) return;
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
      onChange({
        ...value,
        marks: value.marks.flatMap((mark) =>
          mark.id !== selected
            ? [mark]
            : mark.sourceLink !== undefined
              ? [{ ...mark, deleted: true }]
              : [],
        ),
      });
      setSelected(undefined);
    }
  }, [selected, disabled, onChange, value]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
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
    let fieldNumber = 1;
    while (
      fields.some((field) => field.name === `Field ${fieldNumber}`) ||
      addedFieldNames.has(`Field ${fieldNumber}`)
    )
      fieldNumber++;
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
      ...(kind === 'form'
        ? {
            formType,
            fieldName: `Field ${fieldNumber}`,
            fieldValue: formType === 'radio' ? 'Option 1' : '',
            fieldOptions: ['Option 1', 'Option 2'],
            fontSize: 12,
          }
        : {}),
    };
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || event.button !== 0) return;
    const point = coordinates(event);
    if (tool === 'select') {
      setSelected(undefined);
      return;
    }
    if (tool === 'text' || tool === 'existing') {
      commitMark(newMark('text', ...point));
      setTool('select');
      return;
    }
    if (tool === 'image') return;
    event.preventDefault();
    svg.current!.setPointerCapture(event.pointerId);
    const mark = newMark(tool === 'strike' || tool === 'underline' ? 'line' : tool, ...point);
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
    const mark = markFromText(source, page, item);
    if (tool === 'highlight' || tool === 'strike' || tool === 'underline') {
      const width = Math.max(8, mark.width - 12),
        y =
          tool === 'strike'
            ? mark.y + mark.height * 0.4
            : tool === 'underline'
              ? mark.y + mark.height * 0.85
              : mark.y;
      commitMark({
        ...newMark(tool === 'highlight' ? 'highlight' : 'line', mark.x, y),
        width,
        height: tool === 'highlight' ? mark.height : 1,
        ...(tool !== 'highlight'
          ? {
              points: [
                [0, 0],
                [width, 0],
              ],
              strokeWidth: 1,
            }
          : {}),
      });
      return;
    }
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
          <label className="form-tool">
            <Icon name="ListTodo" size={17} />
            <select
              aria-label="Create form field"
              value=""
              disabled={disabled}
              onChange={(e) => {
                setFormType(e.target.value as Mark['formType']);
                setTool('form');
                setSelected(undefined);
              }}
            >
              <option value="" disabled>
                Forms
              </option>
              <option value="text">Text field</option>
              <option value="multiline">Multiline field</option>
              <option value="select">Dropdown</option>
              <option value="checkbox">Checkbox</option>
              <option value="radio">Radio choice</option>
            </select>
          </label>
          <button
            disabled={disabled}
            aria-pressed={findOpen}
            onClick={() => setFindOpen(!findOpen)}
          >
            <Icon name="Search" size={17} />
            <span>Find &amp; replace</span>
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
      {findOpen && (
        <FindReplace
          source={source}
          value={value}
          onChange={onChange}
          disabled={disabled}
          onClose={() => setFindOpen(false)}
          onSelect={(mark) => {
            setPage(mark.page);
            commitMark(mark);
            setTool('select');
          }}
        />
      )}
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
                {['existing', 'text', 'highlight', 'strike', 'underline'].includes(tool) &&
                  textBlocks.map((item) => {
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
                {tool === 'link' &&
                  links
                    .filter(
                      (link) =>
                        link.page === page && !value.marks.some((mark) => mark.id === link.id),
                    )
                    .map((link) => (
                      <rect
                        key={link.id}
                        className="native-link-target"
                        x={link.x}
                        y={link.y}
                        width={link.width}
                        height={link.height}
                        role="button"
                        tabIndex={0}
                        aria-label={`Edit link: ${link.destinationPage ? `Page ${link.destinationPage}` : link.url || 'Document destination'}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          commitMark(link);
                          setTool('select');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            commitMark(link);
                            setTool('select');
                          }
                        }}
                      />
                    ))}
                {shown.map((mark) => (
                  <g
                    key={mark.id}
                    className="annotation"
                    onPointerDown={(e) => {
                      if (
                        tool === 'select' ||
                        (['text', 'existing'].includes(tool) && mark.kind === 'text')
                      )
                        startObject(e, mark);
                    }}
                  >
                    {mark.kind !== 'text' && mark.kind !== 'form' && <MarkGraphic mark={mark} />}
                    {mark.kind === 'form' && (
                      <>
                        <rect
                          x={mark.x}
                          y={mark.y}
                          width={mark.width}
                          height={mark.height}
                          fill="#eff6ff33"
                          stroke="#5881ac"
                          strokeDasharray="3 2"
                        />
                        <text x={mark.x + 4} y={mark.y - 5} fontSize={10} fill="#315a87">
                          {mark.fieldName}
                        </text>
                      </>
                    )}
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
              {(tool === 'select' || tab === 'forms') && (
                <OnPageFields
                  fields={fields}
                  values={value.fields}
                  page={page}
                  info={info}
                  disabled={disabled}
                  onChange={(name, next) =>
                    onChange({ ...value, fields: { ...value.fields, [name]: next } })
                  }
                />
              )}
              {current?.kind === 'text' && current.page === page && (
                <div
                  className="on-page-text"
                  style={{
                    left: `${clamp((current.x / info.width) * 100, 0, Math.max(0, 100 - (320 / stageWidth) * 100))}%`,
                    top: `${Math.min(88, ((current.y + current.height) / info.height) * 100 + 1)}%`,
                  }}
                >
                  <div className="on-page-text-title">
                    <span>
                      {usesOriginalFont(current)
                        ? current.originalText?.fontName
                        : current.fontFamily === 'serif'
                          ? 'Serif'
                          : current.fontFamily === 'mono'
                            ? 'Monospace'
                            : 'Noto Sans'}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Finish editing text"
                      onClick={() => setSelected(undefined)}
                    >
                      <Icon name="Check" size={16} />
                    </button>
                  </div>
                  <textarea
                    ref={textInput}
                    aria-label="Edit text on page"
                    value={current.text || ''}
                    rows={2}
                    disabled={disabled}
                    onChange={(e) =>
                      update({
                        text: e.target.value,
                        height: Math.max(
                          current.height,
                          e.target.value.split('\n').length * current.fontSize * 1.2,
                        ),
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                        e.preventDefault();
                        setSelected(undefined);
                        svg.current?.focus();
                      }
                    }}
                  />
                  <div className="text-format-tools" role="group" aria-label="Text formatting">
                    <select
                      aria-label="On-page font"
                      value={usesOriginalFont(current) ? 'original' : current.fontFamily || 'noto'}
                      disabled={disabled}
                      onChange={(e) =>
                        update(
                          e.target.value === 'original'
                            ? {
                                fontMode: 'original',
                                bold: false,
                                italic: false,
                                underline: false,
                                strike: false,
                              }
                            : {
                                fontMode: 'noto',
                                fontFamily: e.target.value as Mark['fontFamily'],
                              },
                        )
                      }
                    >
                      {current.originalText && <option value="original">Original font</option>}
                      <option value="noto">Noto Sans</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monospace</option>
                    </select>
                    <input
                      type="number"
                      aria-label="On-page font size"
                      min={6}
                      max={150}
                      value={current.fontSize}
                      disabled={disabled}
                      onChange={(e) =>
                        update({ fontSize: clamp(Number(e.target.value) || 6, 6, 150) })
                      }
                    />
                    <input
                      type="color"
                      aria-label="On-page text color"
                      value={current.color}
                      disabled={disabled}
                      onChange={(e) => update({ color: e.target.value })}
                    />
                    {(['bold', 'italic', 'underline', 'strike'] as const).map((style, i) => (
                      <button
                        key={style}
                        title={
                          usesOriginalFont(current)
                            ? 'Choose a replacement font to change its style. Original font styling is preserved.'
                            : ['Bold', 'Italic', 'Underline text', 'Strikethrough text'][i]
                        }
                        aria-label={['Bold', 'Italic', 'Underline text', 'Strikethrough text'][i]}
                        aria-pressed={!!current[style]}
                        disabled={disabled || usesOriginalFont(current)}
                        onClick={() => update({ [style]: !current[style] })}
                      >
                        <Icon
                          name={['Bold', 'Italic', 'Underline', 'Strikethrough'][i]}
                          size={16}
                        />
                      </button>
                    ))}
                  </div>
                  {previewLoading && <small>Updating page preview…</small>}
                </div>
              )}
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
              Form fields <span>{fields.length + addedFieldNames.size}</span>
            </button>
          </div>
          <fieldset disabled={disabled}>
            {tab === 'forms' ? (
              <div className="form-fields">
                <h2>Fill in the details.</h2>
                {fieldError && <p role="alert">{fieldError}</p>}
                {!fields.length ? (
                  <>
                    <p>
                      {addedFields.length
                        ? 'Your new fields are listed below. Select one to change its default value or settings.'
                        : 'No interactive fields were found. Add text to fill in a flat form, or use Forms to create fillable fields.'}
                    </p>
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
                          field.multiline ? (
                            <textarea
                              rows={4}
                              value={String(val)}
                              disabled={field.readOnly}
                              onChange={(e) => set(e.target.value)}
                            />
                          ) : (
                            <input
                              value={String(val)}
                              disabled={field.readOnly}
                              onChange={(e) => set(e.target.value)}
                            />
                          )
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
                {addedFields.length > 0 && (
                  <div className="added-fields">
                    <h3>New fields</h3>
                    {addedFields.map((mark) => (
                      <button
                        key={mark.id}
                        className="button secondary"
                        onClick={() => {
                          setPage(mark.page);
                          setSelected(mark.id);
                          setTab('properties');
                          setTool('select');
                        }}
                      >
                        {mark.fieldName || 'Unnamed field'}
                        {mark.formType === 'radio' ? ` · ${mark.fieldValue}` : ''}
                        <small>Page {mark.page + 1}</small>
                      </button>
                    ))}
                  </div>
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
                      ? 'Edit existing line'
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
                            value={
                              usesOriginalFont(current) ? 'original' : current.fontFamily || 'noto'
                            }
                            onChange={(e) =>
                              update(
                                e.target.value === 'original'
                                  ? {
                                      fontMode: 'original',
                                      bold: false,
                                      italic: false,
                                      underline: false,
                                      strike: false,
                                    }
                                  : {
                                      fontMode: 'noto',
                                      fontFamily: e.target.value as Mark['fontFamily'],
                                    },
                              )
                            }
                          >
                            <option value="original">
                              Original · {current.originalText.fontName}
                            </option>
                            <option value="noto">Noto Sans · change font</option>
                            <option value="serif">Serif · change font</option>
                            <option value="mono">Monospace · change font</option>
                          </select>
                        </label>
                        <p className="inspector-note" data-testid="matched-font">
                          {usesOriginalFont(current)
                            ? `${current.originalText.fontName} · ${current.originalText.fontEmbedded ? 'Embedded in this PDF' : 'Original PDF font reference'}. Font style and baseline are preserved. Related text on this line is edited together. Longer text may need more room.`
                            : `${current.fontFamily === 'serif' ? 'Serif' : current.fontFamily === 'mono' ? 'Monospace' : 'Noto Sans'} replaces the original typeface for this line.`}
                        </p>
                      </>
                    )}
                    <label className="field">
                      Text
                      <textarea
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
                        {current.fontFamily === 'serif' || current.fontFamily === 'mono'
                          ? 'Serif and monospace support Western European text. Choose Noto Sans for Greek or Cyrillic.'
                          : 'Noto Sans supports Latin, Greek and Cyrillic text.'}{' '}
                        Original text is removed when replacing an editable line.
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
                  <>
                    <label className="field">
                      Link destination
                      <select
                        value={current.destinationPage ? 'page' : 'url'}
                        onChange={(e) =>
                          update(
                            e.target.value === 'page'
                              ? { destinationPage: page + 1 }
                              : { destinationPage: undefined, url: current.url || 'https://' },
                          )
                        }
                      >
                        <option value="url">Web or email address</option>
                        <option value="page">Page in this document</option>
                      </select>
                    </label>
                    {current.destinationPage ? (
                      <label className="field">
                        Destination page
                        <input
                          type="number"
                          min={1}
                          max={source.pages.length}
                          value={current.destinationPage}
                          onChange={(e) =>
                            update({
                              destinationPage: clamp(
                                Number(e.target.value) || 1,
                                1,
                                source.pages.length,
                              ),
                            })
                          }
                        />
                      </label>
                    ) : (
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
                  </>
                )}
                {current.kind === 'form' && (
                  <>
                    <label className="field">
                      Field name
                      <input
                        value={current.fieldName || ''}
                        maxLength={120}
                        onChange={(e) => update({ fieldName: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Field type
                      <select
                        value={current.formType}
                        onChange={(e) => update({ formType: e.target.value as Mark['formType'] })}
                      >
                        <option value="text">Text</option>
                        <option value="multiline">Multiline text</option>
                        <option value="select">Dropdown</option>
                        <option value="checkbox">Checkbox</option>
                        <option value="radio">Radio choice</option>
                      </select>
                    </label>
                    {current.formType === 'select' && (
                      <label className="field">
                        Options, one per line
                        <textarea
                          rows={4}
                          value={current.fieldOptions?.join('\n') || ''}
                          onChange={(e) => update({ fieldOptions: e.target.value.split('\n') })}
                        />
                      </label>
                    )}
                    {current.formType !== 'checkbox' && (
                      <label className="field">
                        {current.formType === 'radio' ? 'Choice value' : 'Default value'}
                        <textarea
                          rows={current.formType === 'multiline' ? 4 : 2}
                          value={current.fieldValue || ''}
                          onChange={(e) => update({ fieldValue: e.target.value })}
                        />
                      </label>
                    )}
                    {(current.formType === 'checkbox' || current.formType === 'radio') && (
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={!!current.checked}
                          onChange={(e) => update({ checked: e.target.checked })}
                        />
                        Selected by default
                      </label>
                    )}
                    {current.formType === 'radio' && (
                      <p className="inspector-note">
                        Use the same field name for related choices, and a different choice value
                        for each button.
                      </p>
                    )}
                    <p className="inspector-note">
                      This remains an interactive field in the downloaded PDF unless you flatten it.
                    </p>
                  </>
                )}
                {['rectangle', 'ellipse'].includes(current.kind) && (
                  <>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        checked={!!current.fillColor}
                        onChange={(e) =>
                          update({ fillColor: e.target.checked ? '#fff0ad' : undefined })
                        }
                      />
                      Fill shape
                    </label>
                    {current.fillColor && (
                      <label className="field color-field">
                        Fill color
                        <input
                          type="color"
                          value={current.fillColor}
                          onChange={(e) => update({ fillColor: e.target.value })}
                        />
                      </label>
                    )}
                  </>
                )}
                {!['image', 'cover', 'redact', 'link', 'form'].includes(current.kind) && (
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
                {!['redact', 'cover', 'link', 'form'].includes(current.kind) && (
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
        fill={m.fillColor || 'none'}
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
          ? m.fillColor || 'none'
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
