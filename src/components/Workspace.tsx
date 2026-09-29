import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { RasterSettings } from '../lib/rasterPreview';
import LivePreview, { ImagePagePreview } from './LivePreview';
import { Icon } from './Icon';
import { DocumentPool, Thumbnail } from './PdfCanvas';
import { loadSource, MAX_TOTAL_SIZE } from '../lib/pdf';
import {
  defaultOptions,
  uid,
  type EditState,
  type Output,
  type PageRef,
  type ProcessOptions,
  type SourceFile,
  type Tool,
} from '../lib/types';
import { download, fileSize, humanError } from '../lib/utils';
import { editPdf, imagesToPdf, processPdf } from '../lib/operations';
import { cancelNative } from '../lib/native';
import Editor from './Editor';
import CloudSave from './CloudSave';
import { ToolHelp, ToolUpload } from './ToolLanding';

const emptyEdit = (): EditState => ({ marks: [], fields: {} });
const optionsFor = (tool: Tool): ProcessOptions => ({
  ...defaultOptions,
  ...(tool.id === 'page-numbers'
    ? { fontSize: 12, position: 'bottom' as const, color: '#171719' }
    : {}),
});
export default function Workspace({
  tool,
  onDirty,
  navigate,
  initialFile,
  initialFiles,
  onInitialFilesConsumed,
  onResult,
  cloudSave = true,
  onDocumentChange,
}: {
  tool: Tool;
  onDirty: (value: boolean) => void;
  navigate: (path: string) => void;
  initialFile?: File;
  initialFiles?: File[];
  onInitialFilesConsumed?: () => void;
  onResult?: (result: Output) => void;
  cloudSave?: boolean;
  onDocumentChange?: (open: boolean) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const focusButton = useRef<HTMLButtonElement>(null);
  const workspaceElement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focused) return;
    const background = new Map<HTMLElement, boolean>();
    // Isolate this workspace even when it is embedded in a shared-document screen.
    for (
      let active: HTMLElement | null = workspaceElement.current;
      active && active !== document.body;
      active = active.parentElement
    ) {
      for (const sibling of Array.from(active.parentElement?.children || [])) {
        if (sibling instanceof HTMLElement && sibling !== active) {
          background.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        document.querySelector('dialog[open]')
      )
        return;
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))
        return;
      setFocused(false);
      focusButton.current?.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = overflow;
      for (const [element, inert] of background) element.inert = inert;
      window.removeEventListener('keydown', escape);
    };
  }, [focused]);
  const [files, setFiles] = useState<SourceFile[]>([]),
    [images, setImages] = useState<File[]>([]),
    [refs, setRefs] = useState<PageRef[]>([]);
  const [options, setOptions] = useState<ProcessOptions>(() => optionsFor(tool));
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(''),
    [result, setResult] = useState<Output>();
  const [passwordRequest, setPasswordRequest] = useState<{
    name: string;
    resolve: (value: string | null) => void;
  }>();
  const [history, setHistory] = useState<EditState[]>([emptyEdit()]),
    [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | undefined>(undefined),
    alive = useRef(true),
    passwordRef = useRef(passwordRequest);
  const pool = useMemo(() => new DocumentPool(), []),
    edit = history[cursor],
    isImages = tool.id === 'images-to-pdf',
    hasFiles = isImages ? images.length > 0 : files.length > 0;
  passwordRef.current = passwordRequest;
  const imported = useRef(false);
  useEffect(() => {
    onDocumentChange?.(!!tool.editor && files.length > 0);
    return () => onDocumentChange?.(false);
  }, [onDocumentChange, tool.editor, files[0]?.id]);
  useEffect(() => {
    const selected = initialFiles || (initialFile ? [initialFile] : []);
    if (!selected.length || imported.current) return;
    const timer = window.setTimeout(() => {
      imported.current = true;
      void addFiles(selected).finally(() => onInitialFilesConsumed?.());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialFile, initialFiles]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      passwordRef.current?.resolve(null);
      pool.destroy();
      cancelNative();
    };
  }, [pool]);
  const commit = useCallback(
    (next: EditState, replaceCurrent = false) => {
      // Resolving a font-choice dialog completes the pending text edit rather
      // than adding an undo step that would reopen the same blocking dialog.
      setHistory((old) => [...old.slice(0, cursor + (replaceCurrent ? 0 : 1)), next].slice(-80));
      setCursor(Math.min(cursor + (replaceCurrent ? 0 : 1), 79));
      setResult(undefined);
      onDirty(true);
    },
    [cursor, onDirty],
  );
  const changeOptions = (patch: Partial<ProcessOptions>) => {
    setOptions((old) => ({ ...old, ...patch }));
    setResult(undefined);
    onDirty(true);
  };
  async function addFiles(selected: File[]) {
    if (!selected.length || loading || busy) return;
    setError('');
    setLoading(true);
    try {
      if ((isImages ? images.length : files.length) + selected.length > 50)
        throw new Error('Add up to 50 files at a time.');
      if (
        [...selected, ...(isImages ? images : files)].reduce(
          (total, file) => total + file.size,
          0,
        ) > MAX_TOTAL_SIZE
      )
        throw new Error('Choose files totaling less than 160 MB to fit browser memory.');
      if (isImages) {
        if (selected.some((file) => !/^image\/(jpeg|png|webp)$/.test(file.type)))
          throw new Error('Choose JPG, PNG or WebP images.');
        setImages((old) => [...old, ...selected]);
      } else {
        const incoming = tool.multiple ? selected : selected.slice(0, 1),
          loaded: SourceFile[] = [];
        for (const file of incoming) {
          let password = '';
          while (alive.current) {
            try {
              loaded.push(await loadSource(file, password));
              break;
            } catch (e) {
              if (e instanceof Error && e.message === 'PASSWORD_REQUIRED') {
                const value = await new Promise<string | null>((resolve) =>
                  setPasswordRequest({ name: file.name, resolve }),
                );
                if (value === null) return;
                password = value;
                setPasswordRequest(undefined);
              } else throw e;
            }
          }
        }
        if (!alive.current) return;
        if (loaded.reduce((sum, file) => sum + file.pages.length, refs.length) > 1000)
          throw new Error('Choose up to 1,000 pages in total.');
        setFiles((old) => (tool.multiple ? [...old, ...loaded] : loaded));
        setRefs((old) => [
          ...(tool.multiple ? old : []),
          ...loaded.flatMap((file) =>
            file.pages.map((_, index) => ({ id: uid(), fileId: file.id, index, rotation: 0 })),
          ),
        ]);
      }
      setResult(undefined);
    } catch (e) {
      if (alive.current) setError(humanError(e));
    } finally {
      if (alive.current) {
        setLoading(false);
        setPasswordRequest(undefined);
      }
      if (input.current) input.current.value = '';
    }
  }
  function updateRefs(next: PageRef[]) {
    setRefs(next);
    setResult(undefined);
    onDirty(true);
  }
  async function run() {
    if (busy || loading) return;
    setBusy(true);
    setError('');
    setProgress(0);
    controller.current = new AbortController();
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const output = isImages
        ? await imagesToPdf(images, options, setProgress, controller.current.signal)
        : tool.editor
          ? await editPdf(
              files[0],
              edit,
              options.flattenForms,
              setProgress,
              controller.current.signal,
            )
          : await processPdf(tool.id, files, refs, options, setProgress, controller.current.signal);
      if (controller.current.signal.aborted || !alive.current) return;
      setResult(output);
      onResult?.(output);
      onDirty(false);
      download(output.bytes, output.name, output.mime);
    } catch (e) {
      if (alive.current) setError(humanError(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function reset() {
    if (
      (edit.marks.length ||
        Object.keys(edit.fields).length ||
        edit.pageOrder?.some((page, index) => page !== index)) &&
      !window.confirm('Close this document and discard unsaved changes?')
    )
      return;
    controller.current?.abort();
    setFocused(false);
    setFiles([]);
    setImages([]);
    setRefs([]);
    setHistory([emptyEdit()]);
    setOptions(optionsFor(tool));
    setCursor(0);
    setResult(undefined);
    setError('');
    onDirty(false);
    pool.destroy();
  }
  const fileInput = (
    <input
      ref={input}
      className="sr-only"
      type="file"
      aria-label={isImages ? 'Choose images' : 'Choose PDF files'}
      accept={isImages ? 'image/jpeg,image/png,image/webp' : '.pdf,application/pdf'}
      multiple={tool.multiple}
      onChange={(e) => void addFiles(Array.from(e.target.files || []))}
    />
  );
  return (
    <div
      ref={workspaceElement}
      className={`workspace ${hasFiles ? 'has-document' : ''} ${tool.editor && hasFiles ? 'editing-workspace' : ''} ${focused ? 'workspace-focused' : ''}`}
    >
      {hasFiles && fileInput}
      <div className="workspace-heading">
        <div>
          <span className={`tool-icon small ${tool.accent}`}>
            <Icon name={tool.icon} size={22} />
          </span>
          <div>
            <h1>{tool.name}</h1>
            <p>
              {hasFiles
                ? isImages
                  ? `${images.length} images`
                  : `${files.map((f) => f.name).join(', ')} · ${refs.length} ${refs.length === 1 ? 'page' : 'pages'}`
                : tool.description}
            </p>
          </div>
        </div>
        {hasFiles && tool.editor && <div className="workspace-toolbar" ref={setToolbarTarget} />}
        {hasFiles && (
          <div className="workspace-actions">
            {tool.editor && (
              <button
                ref={focusButton}
                className="button secondary focus-view-button"
                aria-pressed={focused}
                aria-label={focused ? 'Exit focus view' : 'Focus view'}
                title={focused ? 'Exit focus view (Escape)' : 'Use the full window for editing'}
                onClick={() => setFocused(!focused)}
              >
                <Icon name={focused ? 'Minimize' : 'Maximize'} size={17} />
                <span>{focused ? 'Exit focus' : 'Focus view'}</span>
              </button>
            )}
            <button
              className="icon-button"
              title="Close document"
              aria-label="Close document"
              disabled={busy}
              onClick={reset}
            >
              <Icon name="X" size={19} />
            </button>
            <button
              className="button"
              disabled={busy || loading || (!isImages && !refs.length)}
              onClick={() => void run()}
            >
              {busy ? (
                <>
                  <span className="spinner light" />
                  {progress > 0 ? `${Math.round(progress * 100)}%` : 'Working…'}
                </>
              ) : (
                <>
                  <Icon name="Download" size={17} />
                  {tool.action}
                </>
              )}
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <Icon name="CircleAlert" size={19} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <Icon name="X" size={17} />
          </button>
        </div>
      )}
      {result && (
        <div className="result-banner" role="status">
          <span className="result-check">
            <Icon name="Check" size={20} />
          </span>
          <div>
            <strong>Your file is ready.</strong>
            <p>
              {result.name} · {fileSize(result.bytes.length)}
              {result.note && <span className="result-note">{result.note}</span>}
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => download(result.bytes, result.name, result.mime)}
          >
            <Icon name="Download" size={16} />
            Download again
          </button>
          {cloudSave && <CloudSave key={result.name + result.bytes.length} output={result} />}
          {tool.editor && (
            <button
              className="icon-button dismiss-result"
              aria-label="Dismiss download notice"
              title="Dismiss download notice"
              onClick={() => setResult(undefined)}
            >
              <Icon name="X" size={17} />
            </button>
          )}
        </div>
      )}
      {busy && (
        <div className="processing-strip" role="status">
          <span>
            {progress > 0
              ? `Processing your document · ${Math.round(progress * 100)}%`
              : 'Processing on your device…'}
          </span>
          <button
            onClick={() => {
              controller.current?.abort();
              cancelNative();
            }}
          >
            Cancel
          </button>
          <div style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      )}
      {!hasFiles ? (
        <>
          <ToolUpload tool={tool} onFiles={addFiles} loading={loading} />
          <ToolHelp tool={tool} navigate={navigate} />
        </>
      ) : tool.editor ? (
        <Editor
          toolbarTarget={toolbarTarget}
          focused={focused}
          key={files[0].id}
          source={files[0]}
          value={edit}
          onChange={commit}
          undo={() => {
            if (cursor > 0) {
              setCursor(cursor - 1);
              setResult(undefined);
              onDirty(true);
            }
          }}
          redo={() => {
            if (cursor < history.length - 1) {
              setCursor(cursor + 1);
              setResult(undefined);
              onDirty(true);
            }
          }}
          canUndo={cursor > 0}
          canRedo={cursor < history.length - 1}
          mode={tool.id}
          disabled={busy}
          onError={setError}
          flatten={options.flattenForms}
          setFlatten={(value) => changeOptions({ flattenForms: value })}
        />
      ) : (
        <div className="tool-workbench">
          <div className="document-area">
            <div className="document-toolbar">
              <span>
                <Icon name={isImages ? 'Images' : 'Files'} size={16} />
                {isImages ? 'Your images' : 'Your pages'}
              </span>
              <div>
                {tool.multiple && (
                  <button
                    className="button small secondary"
                    disabled={busy || loading}
                    onClick={() => input.current?.click()}
                  >
                    <Icon name="Plus" size={15} />
                    {isImages ? 'Add images' : 'Add PDFs'}
                  </button>
                )}
                {['organize', 'rotate', 'merge'].includes(tool.id) && (
                  <button
                    className="button small secondary"
                    disabled={busy}
                    onClick={() =>
                      updateRefs(
                        refs.map((ref) => ({ ...ref, rotation: (ref.rotation + 90) % 360 })),
                      )
                    }
                  >
                    <Icon name="RotateCw" size={15} />
                    Rotate all
                  </button>
                )}
              </div>
            </div>
            <LivePreview
              tool={tool}
              files={files}
              images={images}
              refs={refs}
              options={options}
              pool={pool}
            >
              {({ refs: previewRefs, previewDoc, raster, groups, onSelect }) =>
                isImages ? (
                  <ImageList
                    files={images}
                    options={options}
                    onSelect={onSelect}
                    disabled={busy}
                    onChange={(next) => {
                      setImages(next);
                      setResult(undefined);
                      onDirty(true);
                    }}
                  />
                ) : (
                  <PageList
                    files={files}
                    refs={previewRefs}
                    pool={pool}
                    previewDoc={previewDoc}
                    raster={raster}
                    groups={groups}
                    onSelect={onSelect}
                    editable={['merge', 'organize', 'rotate'].includes(tool.id)}
                    disabled={busy}
                    onChange={updateRefs}
                  />
                )
              }
            </LivePreview>
          </div>
          <aside className="options-panel">
            <span className="eyebrow">MAKE IT YOURS</span>
            <h2>{tool.id === 'merge' ? 'A little organization.' : 'Your options'}</h2>
            <p className="option-description">{tool.detail}</p>
            <fieldset disabled={busy}>
              <Options
                tool={tool}
                options={options}
                change={changeOptions}
                pageCount={refs.length}
              />
            </fieldset>
            <div className="options-local">
              <Icon name="HardDrive" size={17} />
              <span>Processed here, on your device.</span>
            </div>
          </aside>
        </div>
      )}
      {passwordRequest && (
        <PasswordDialog
          name={passwordRequest.name}
          onDone={(value) => {
            passwordRequest.resolve(value);
            setPasswordRequest(undefined);
          }}
        />
      )}
    </div>
  );
}
function PasswordDialog({
  name,
  onDone,
}: {
  name: string;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      className="modal"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onDone(null);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone(value);
        }}
      >
        <Icon name="LockKeyhole" size={28} />
        <h2>This PDF is protected.</h2>
        <p>
          Enter the password for <strong>{name}</strong>. It stays on this device.
        </p>
        <label className="field">
          PDF password
          <input
            autoFocus
            autoComplete="off"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="button">Open PDF</button>
        </div>
      </form>
    </dialog>
  );
}
function PageList({
  files,
  refs,
  pool,
  editable,
  disabled,
  onChange,
  previewDoc,
  raster,
  groups,
  onSelect,
}: {
  files: SourceFile[];
  refs: PageRef[];
  pool: DocumentPool;
  editable: boolean;
  disabled: boolean;
  onChange: (refs: PageRef[]) => void;
  previewDoc?: PDFDocumentProxy;
  raster?: RasterSettings;
  groups: Map<string, number>;
  onSelect: (index: number) => void;
}) {
  const drag = useRef<number | undefined>(undefined);
  const move = (from: number, to: number) => {
    if (disabled || to < 0 || to >= refs.length) return;
    const next = [...refs];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  return (
    <div className={`pages-grid ${editable ? 'editable-pages' : ''}`}>
      {refs.map((ref, position) => {
        const source = files.find((f) => f.id === ref.fileId)!;
        return (
          <div
            className="page-tile"
            key={ref.id}
            draggable={editable && !disabled}
            onDragStart={() => {
              drag.current = position;
            }}
            onDragOver={(e) => editable && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag.current !== undefined) {
                move(drag.current, position);
                drag.current = undefined;
              }
            }}
          >
            <div className="page-tile-number">
              <span>{String(position + 1).padStart(2, '0')}</span>
              {editable && <Icon name="Grip" size={14} />}
            </div>
            <button
              className="preview-page-button"
              aria-label={`Preview page ${position + 1}`}
              onClick={() => onSelect(position)}
            >
              <Thumbnail
                source={source}
                index={ref.index}
                rotation={ref.rotation}
                pool={pool}
                previewDoc={previewDoc}
                raster={raster}
              />
            </button>
            {groups.has(ref.id) && (
              <span className="split-preview-group">PDF {groups.get(ref.id)}</span>
            )}
            <span className="page-filename" title={source.name}>
              {files.length > 1 ? source.name : `Page ${ref.index + 1}`}
            </span>
            {editable && (
              <div className="page-tile-actions">
                <button
                  aria-label={`Move page ${position + 1} earlier`}
                  title="Move earlier"
                  disabled={disabled || position === 0}
                  onClick={() => move(position, position - 1)}
                >
                  <Icon name="ArrowLeft" size={14} />
                </button>
                <button
                  aria-label={`Move page ${position + 1} later`}
                  title="Move later"
                  disabled={disabled || position === refs.length - 1}
                  onClick={() => move(position, position + 1)}
                >
                  <Icon name="ArrowRight" size={14} />
                </button>
                <button
                  aria-label={`Rotate page ${position + 1}`}
                  title="Rotate"
                  disabled={disabled}
                  onClick={() =>
                    onChange(
                      refs.map((item) =>
                        item.id === ref.id
                          ? { ...item, rotation: (item.rotation + 90) % 360 }
                          : item,
                      ),
                    )
                  }
                >
                  <Icon name="RotateCw" size={14} />
                </button>
                <button
                  aria-label={`Duplicate page ${position + 1}`}
                  title="Duplicate"
                  disabled={disabled || refs.length >= 1000}
                  onClick={() => {
                    const next = [...refs];
                    next.splice(position + 1, 0, { ...ref, id: uid() });
                    onChange(next);
                  }}
                >
                  <Icon name="Copy" size={14} />
                </button>
                <button
                  aria-label={`Remove page ${position + 1}`}
                  title="Remove"
                  disabled={disabled || refs.length === 1}
                  onClick={() => onChange(refs.filter((item) => item.id !== ref.id))}
                >
                  <Icon name="Trash2" size={14} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function ImageList({
  files,
  disabled,
  onChange,
  options,
  onSelect,
}: {
  files: File[];
  disabled: boolean;
  onChange: (files: File[]) => void;
  options: ProcessOptions;
  onSelect: (index: number) => void;
}) {
  function move(i: number, d: number) {
    const next = [...files];
    next.splice(i + d, 0, next.splice(i, 1)[0]);
    onChange(next);
  }
  return (
    <div className="pages-grid">
      {files.map((file, index) => (
        <div key={`${file.name}-${index}`} className="page-tile">
          <div className="page-tile-number">{String(index + 1).padStart(2, '0')}</div>
          <button
            className="preview-page-button"
            aria-label={`Preview image ${index + 1}`}
            onClick={() => onSelect(index)}
          >
            <ImagePagePreview file={file} options={options} />
          </button>
          <span className="page-filename">{file.name}</span>
          <div className="page-tile-actions">
            <button
              aria-label={`Move image ${index + 1} earlier`}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
            >
              <Icon name="ArrowLeft" size={15} />
            </button>
            <button
              aria-label={`Move image ${index + 1} later`}
              disabled={disabled || index === files.length - 1}
              onClick={() => move(index, 1)}
            >
              <Icon name="ArrowRight" size={15} />
            </button>
            <button
              aria-label={`Remove image ${index + 1}`}
              disabled={disabled}
              onClick={() => onChange(files.filter((_, i) => i !== index))}
            >
              <Icon name="Trash2" size={15} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
function Options({
  tool,
  options: o,
  change,
  pageCount,
}: {
  tool: Tool;
  options: ProcessOptions;
  change: (patch: Partial<ProcessOptions>) => void;
  pageCount: number;
}) {
  const id = tool.id,
    number = (key: keyof ProcessOptions, value: string, min: number, max: number) =>
      change({ [key]: Math.max(min, Math.min(max, Number(value) || min)) });
  return (
    <div className="tool-options">
      {['extract', 'delete', 'text', 'pdf-to-images', 'watermark', 'page-numbers', 'crop'].includes(
        id,
      ) && (
        <label className="field">
          {id === 'delete' ? 'Pages to remove' : 'Pages'}
          <input
            aria-label={id === 'delete' ? 'Pages to remove' : 'Pages'}
            aria-describedby="page-selection-help"
            value={o.range}
            placeholder={id === 'delete' ? 'For example: 2, 4-6' : 'All pages (or 1, 3-5)'}
            onChange={(e) => change({ range: e.target.value })}
          />
          <span id="page-selection-help">
            Use numbers and ranges. This PDF has {pageCount} pages.
          </span>
        </label>
      )}
      {id === 'split' && (
        <>
          <label className="field">
            Split by
            <select
              aria-label="Split by"
              value={o.splitMode}
              onChange={(e) => change({ splitMode: e.target.value as ProcessOptions['splitMode'] })}
            >
              <option value="pages">Every page into a separate PDF</option>
              <option value="every">Every few pages</option>
              <option value="ranges">Custom page ranges</option>
            </select>
          </label>
          {o.splitMode === 'every' && (
            <label className="field">
              Pages per PDF
              <input
                type="number"
                min={1}
                max={pageCount}
                value={o.every}
                onChange={(e) => number('every', e.target.value, 1, pageCount)}
              />
            </label>
          )}
          {o.splitMode === 'ranges' && (
            <label className="field">
              Separate ranges
              <input
                aria-label="Separate ranges"
                value={o.range}
                placeholder="1-3, 4-6, 7"
                onChange={(e) => change({ range: e.target.value })}
              />
              <span>Each comma-separated range becomes a new PDF.</span>
            </label>
          )}
          <div className="option-tip">
            <Icon name="Archive" size={18} />
            Your PDFs will download together in a ZIP file.
          </div>
        </>
      )}
      {['compress', 'pdf-to-images', 'grayscale'].includes(id) && (
        <>
          <label className="field">
            Resolution
            <select
              aria-label="Resolution"
              value={o.dpi}
              onChange={(e) => change({ dpi: Number(e.target.value) })}
            >
              <option value={72}>72 DPI · smallest</option>
              <option value={120}>120 DPI · balanced</option>
              <option value={150}>150 DPI · clear</option>
              <option value={200}>200 DPI · high quality</option>
              <option value={300}>300 DPI · print quality</option>
            </select>
          </label>
          {id === 'pdf-to-images' && (
            <label className="field">
              Image format
              <select
                aria-label="Image format"
                value={o.format}
                onChange={(e) => change({ format: e.target.value as 'jpg' | 'png' })}
              >
                <option value="jpg">JPG · smaller files</option>
                <option value="png">PNG · lossless images</option>
              </select>
            </label>
          )}
          {(id !== 'pdf-to-images' || o.format === 'jpg') && (
            <label className="field">
              Image quality <span className="field-value">{Math.round(o.quality * 100)}%</span>
              <input
                type="range"
                min={0.25}
                max={0.95}
                step={0.05}
                aria-label="Image quality"
                value={o.quality}
                onChange={(e) => change({ quality: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}
      {id === 'images-to-pdf' && (
        <>
          <label className="field">
            Page size
            <select
              aria-label="Page size"
              value={o.imageSize}
              onChange={(e) => change({ imageSize: e.target.value as ProcessOptions['imageSize'] })}
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="fit">Fit image</option>
            </select>
          </label>
          {o.imageSize !== 'fit' && (
            <label className="field">
              Orientation
              <select
                aria-label="Orientation"
                value={o.orientation}
                onChange={(e) =>
                  change({ orientation: e.target.value as 'portrait' | 'landscape' })
                }
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
          )}
        </>
      )}
      {['crop', 'images-to-pdf'].includes(id) && (
        <label className="field">
          Margin (points)
          <input
            type="number"
            min={0}
            max={200}
            aria-label="Margin (points)"
            value={o.margins}
            onChange={(e) => number('margins', e.target.value, 0, 200)}
          />
          <span>72 points = 1 inch.</span>
        </label>
      )}
      {['watermark', 'page-numbers'].includes(id) && (
        <>
          {id === 'watermark' ? (
            <label className="field">
              Watermark text
              <input
                maxLength={200}
                value={o.text}
                onChange={(e) => change({ text: e.target.value })}
              />
            </label>
          ) : (
            <label className="field">
              Start numbering at
              <input
                type="number"
                min={1}
                max={99999}
                value={o.start}
                onChange={(e) => number('start', e.target.value, 1, 99999)}
              />
            </label>
          )}
          <label className="field">
            Font size
            <input
              type="number"
              min={8}
              max={id === 'page-numbers' ? 24 : 150}
              value={o.fontSize}
              onChange={(e) =>
                number('fontSize', e.target.value, 8, id === 'page-numbers' ? 24 : 150)
              }
            />
          </label>
          <label className="field">
            Position
            <select
              aria-label="Position"
              value={o.position}
              onChange={(e) => change({ position: e.target.value as ProcessOptions['position'] })}
            >
              <option value="top">Top center</option>
              {id === 'watermark' && <option value="center">Center</option>}
              <option value="bottom">Bottom center</option>
            </select>
          </label>
          <label className="field color-field">
            Text color
            <input
              type="color"
              value={o.color}
              onChange={(e) => change({ color: e.target.value })}
            />
          </label>
          {id === 'watermark' && (
            <label className="field">
              Opacity <span className="field-value">{Math.round(o.opacity * 100)}%</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                aria-label="Opacity"
                value={o.opacity}
                onChange={(e) => change({ opacity: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}
      {id === 'protect' && (
        <>
          <label className="field">
            Password to open the PDF
            <input
              autoComplete="new-password"
              type="password"
              minLength={1}
              maxLength={127}
              value={o.password}
              onChange={(e) => change({ password: e.target.value })}
            />
            <span>Use a long, unique password. It cannot be recovered by Rovty.</span>
          </label>
          <label className="field">
            Owner password (optional)
            <input
              autoComplete="new-password"
              type="password"
              maxLength={127}
              value={o.ownerPassword}
              onChange={(e) => change({ ownerPassword: e.target.value })}
            />
            <span>If left blank, a random owner password is generated.</span>
          </label>
        </>
      )}
      {id === 'metadata' && (
        <>
          <label className="field">
            Title
            <input
              value={o.title}
              maxLength={500}
              placeholder="Leave blank to remove"
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label className="field">
            Author
            <input
              value={o.author}
              maxLength={200}
              placeholder="Leave blank to remove"
              onChange={(e) => change({ author: e.target.value })}
            />
          </label>
        </>
      )}
      {['merge', 'organize', 'rotate'].includes(id) && (
        <div className="option-tip">
          <Icon name="MousePointer2" size={19} />
          <span>
            Drag pages to reorder them, or use the buttons below each page. Changes apply to your
            downloaded copy.
          </span>
        </div>
      )}
    </div>
  );
}
