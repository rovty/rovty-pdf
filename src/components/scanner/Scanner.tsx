import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { ScannerClient, type ScanResult } from '../../lib/scannerClient';
import {
  fullQuad,
  scanFilters,
  scanModes,
  scanAppearanceKey,
  type ScanMode,
  type ScanPage,
  type ScanExportOptions,
  type ScanSettings,
} from '../../lib/scannerTypes';
import type { Output } from '../../lib/types';
import { download } from '../../lib/utils';
import ScanCrop from './ScanCrop';
import ScanCamera from './ScanCamera';
import '../../scanner.css';
export interface ScannerProps {
  initialFiles: File[];
  startCamera: boolean;
  onDirty: (dirty: boolean) => void;
  onDocumentChange?: (open: boolean) => void;
  onOpen: (file: File) => void;
}
export default function Scanner({
  initialFiles,
  startCamera,
  onDirty,
  onDocumentChange,
  onOpen,
}: ScannerProps) {
  const [client] = useState(() => new ScannerClient()),
    [pages, setPages] = useState<ScanPage[]>([]),
    [selected, setSelected] = useState('');
  const [mode, setMode] = useState<ScanMode>('document'),
    [camera, setCamera] = useState(startCamera),
    [crop, setCrop] = useState(false),
    [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<{
      id: string;
      url: string;
      key: string;
      result: ScanResult;
    }>(),
    [previewBusy, setPreviewBusy] = useState(false);
  const [options, setOptions] = useState<ScanExportOptions>({
    name: 'Rovty scan',
    paper: 'a4',
    quality: 'high',
    margin: 18,
    idLayout: false,
  });
  const [result, setResult] = useState<Output>(),
    [progress, setProgress] = useState(0),
    [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null),
    nativeCamera = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    urls = useRef(new Set<string>()),
    locked = useRef(false),
    controller = useRef<AbortController | undefined>(undefined);
  const queue = useRef(pages);
  queue.current = pages;
  const current = pages.find((p) => p.id === selected) || pages[0];
  const resultRef = useRef(result);
  resultRef.current = result;
  const sequence = useRef(0),
    initialized = useRef(false),
    drag = useRef<string | undefined>(undefined),
    thumbnailFailures = useRef(new Set<string>());
  const objectUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }, []);
  const release = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      client.close();
      controller.current?.abort();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
      onDocumentChange?.(false);
    };
  }, [client, onDocumentChange]);
  useEffect(() => {
    onDocumentChange?.(true);
  }, [onDocumentChange]);
  function changed() {
    setResult(undefined);
    onDirty(queue.current.length > 0 || locked.current);
    setNotice('');
  }
  async function addPhotos(files: Blob[], replaceId?: string): Promise<boolean> {
    if (locked.current || !files.length) return false;
    if (pages.length + files.length - (replaceId ? 1 : 0) > 40) {
      setError('Keep up to 40 scans in one document. Export this batch before starting another.');
      return false;
    }
    if (
      files.some((file) => file.size > 40 * 1024 * 1024) ||
      files.reduce((sum, file) => sum + file.size, 0) > 160 * 1024 * 1024
    ) {
      setError('Choose photos under 40 MB each, totaling less than 160 MB.');
      return false;
    }
    if (files.some((file) => !/^image\/(jpeg|png|webp|avif|heic|heif)$/.test(file.type))) {
      setError('Choose JPG, PNG, WebP or supported phone photos.');
      return false;
    }
    locked.current = true;
    setError('');
    let added = 0;
    try {
      for (const [i, file] of files.entries()) {
        setBusy(`Preparing scan ${i + 1} of ${files.length}…`);
        const processed = await client.run({ action: 'prepare', blob: file });
        if (!alive.current) return false;
        const page: ScanPage = {
          id: crypto.randomUUID(),
          name: file instanceof File ? file.name : `Camera scan ${pages.length + i + 1}`,
          source: processed.blob,
          sourceUrl: objectUrl(processed.blob),
          thumbnail: objectUrl(processed.thumbnail!),
          width: processed.width,
          height: processed.height,
          quad: mode === 'photo' ? fullQuad() : processed.quad,
          detected: processed.detected,
          filter: mode === 'photo' ? 'original' : mode === 'receipt' ? 'bw' : 'color',
          brightness: 0,
          contrast: 0,
          rotation: 0,
        };
        if (
          queue.current.reduce((sum, p) => sum + (p.id === replaceId ? 0 : p.source.size), 0) +
            page.source.size >
          100 * 1024 * 1024
        ) {
          release(page.sourceUrl);
          release(page.thumbnail);
          throw new Error(
            'This batch is reaching the device memory limit. Export it before scanning more.',
          );
        }
        setPages((previous) =>
          replaceId
            ? previous.map((old) => (old.id === replaceId ? page : old))
            : [...previous, page],
        );
        if (replaceId) {
          const old = pages.find((p) => p.id === replaceId);
          if (old) {
            release(old.sourceUrl);
            release(old.thumbnail);
          }
        }
        setSelected(page.id);
        setCrop(!processed.detected && mode !== 'photo');
        changed();
        added++;
      }
      setNotice(
        `${added} ${added === 1 ? 'scan' : 'scans'} added. Review the corners and clarity before exporting.`,
      );
    } catch (cause) {
      if (alive.current)
        setError(
          (added ? `${added} scans were kept. ` : '') +
            (cause instanceof Error ? cause.message : 'This image could not be scanned.'),
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
      if (input.current) input.current.value = '';
      if (nativeCamera.current) nativeCamera.current.value = '';
    }
    return added > 0;
  }
  const addLatest = useRef(addPhotos);
  addLatest.current = addPhotos;
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (initialFiles.length) void addLatest.current(initialFiles);
  }, [initialFiles]);
  const previewKey = current ? scanAppearanceKey(current) : '';
  useEffect(() => {
    if (!current) return;
    let active = true;
    const seq = ++sequence.current;
    setPreviewBusy(true);
    const timer = setTimeout(() => {
      void client
        .run({
          action: 'render',
          blob: current.source,
          quad: current.quad,
          settings: current,
          maxEdge: 1400,
        })
        .then((next) => {
          if (!active || !alive.current || seq !== sequence.current) return;
          const nextPreview = {
            id: current.id,
            url: objectUrl(next.blob),
            result: next,
            key: previewKey,
          };
          setPreview((old) => {
            if (old) release(old.url);
            return nextPreview;
          });
          if (next.thumbnail) {
            const thumbnail = objectUrl(next.thumbnail);
            setPages((previous) =>
              previous.map((page) => {
                if (page.id !== current.id) return page;
                release(page.thumbnail);
                return { ...page, thumbnail, thumbnailKey: previewKey };
              }),
            );
          }
          setPreviewBusy(false);
        })
        .catch((cause) => {
          if (active && alive.current) {
            setError(cause.message);
            setPreviewBusy(false);
          }
        });
    }, 120);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [previewKey, client, objectUrl, release]);
  // Refresh other thumbnails one at a time, after the active preview is ready.
  // This keeps batch color changes visible without queuing work ahead of editing.
  useEffect(() => {
    if (busy || camera || previewBusy) return;
    const page = pages.find((item) => {
      const key = scanAppearanceKey(item);
      return (
        item.id !== current?.id && item.thumbnailKey !== key && !thumbnailFailures.current.has(key)
      );
    });
    if (!page) return;
    const key = scanAppearanceKey(page);
    let active = true;
    const timer = setTimeout(() => {
      void client
        .run({
          action: 'render',
          blob: page.source,
          quad: page.quad,
          settings: page,
          maxEdge: 180,
        })
        .then((next) => {
          if (!active || !alive.current || !next.thumbnail) return;
          const thumbnail = objectUrl(next.thumbnail);
          setPages((previous) =>
            previous.map((item) => {
              if (item.id !== page.id) return item;
              release(item.thumbnail);
              return { ...item, thumbnail, thumbnailKey: key };
            }),
          );
        })
        .catch(() => {
          // A thumbnail must never prevent reviewing or exporting the source scan.
          thumbnailFailures.current.add(key);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pages, current?.id, busy, camera, previewBusy, client, objectUrl, release]);
  function update(patch: Partial<ScanPage>) {
    if (!current || busy) return;
    setPages((previous) =>
      previous.map((page) => (page.id === current.id ? { ...page, ...patch } : page)),
    );
    changed();
  }
  function updateOptions(patch: Partial<ScanExportOptions>) {
    setOptions((previous) => ({ ...previous, ...patch }));
    changed();
  }
  function chooseMode(next: ScanMode) {
    setMode(next);
    updateOptions({
      idLayout: next === 'id',
      paper: next === 'receipt' || next === 'photo' ? 'fit' : 'a4',
    });
  }
  function movePage(id: string, offset: number) {
    setPages((previous) => {
      const index = previous.findIndex((page) => page.id === id);
      const next = [...previous];
      const dest = Math.max(0, Math.min(next.length - 1, index + offset));
      next.splice(dest, 0, next.splice(index, 1)[0]);
      return next;
    });
    changed();
  }
  function remove() {
    if (!current) return;
    const index = pages.indexOf(current);
    setPages(pages.filter((page) => page.id !== current.id));
    release(current.sourceUrl);
    release(current.thumbnail);
    setSelected(pages[index + 1]?.id || pages[index - 1]?.id || '');
    changed();
    if (pages.length === 1) onDirty(false);
  }
  async function exportPdf(open = false) {
    if (locked.current || !pages.length) return;
    locked.current = true;
    setBusy('Creating your PDF…');
    setError('');
    setProgress(0);
    controller.current = new AbortController();
    try {
      const { exportScans } = await import('../../lib/scanExport');
      const output =
        resultRef.current ||
        (await exportScans(
          pages,
          client,
          options,
          (n) => {
            if (alive.current) setProgress(n);
          },
          controller.current.signal,
        ));
      if (!alive.current || controller.current.signal.aborted) return;
      setResult(output);
      onDirty(false);
      setNotice('Your PDF is ready. Download it again or continue in the editor.');
      if (open)
        onOpen(new File([new Uint8Array(output.bytes)], output.name, { type: output.mime }));
      else download(output.bytes, output.name, output.mime);
    } catch (cause) {
      if (alive.current && !controller.current.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'The PDF could not be created. Your scans are still here.',
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
    }
  }
  async function share() {
    if (!result) return;
    const file = new File([new Uint8Array(result.bytes)], result.name, { type: result.mime });
    try {
      await navigator.share({ files: [file], title: options.name });
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError')
        setError('Sharing is unavailable here. Use Download PDF to save the file.');
    }
  }
  const readyPreview = preview?.id === current?.id ? preview : undefined;
  const retake = useRef<string | undefined>(undefined);
  return (
    <div className="scan-workspace">
      <header className="scan-header">
        <div>
          <span className="tool-icon mint">
            <Icon name="ScanLine" size={25} />
          </span>
          <div>
            <h1>Scan to PDF</h1>
            <p>
              {pages.length
                ? `${pages.length} ${pages.length === 1 ? 'scan' : 'scans'} · saved only when you export`
                : 'Clear scans. Wherever you are.'}
            </p>
          </div>
        </div>
        <div className="scan-header-actions">
          {pages.length > 0 && (
            <>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => void exportPdf(true)}
              >
                Open in editor
                <Icon name="FilePenLine" size={17} />
              </button>
              <button
                className="button"
                disabled={!!busy || previewBusy}
                onClick={() => void exportPdf()}
              >
                <Icon name="Download" size={17} />
                Download PDF
              </button>
            </>
          )}
        </div>
      </header>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
        multiple
        aria-label="Import scan photos"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          void addPhotos(files);
        }}
      />
      <input
        ref={nativeCamera}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a scan photo"
        onChange={(e) => {
          const id = retake.current;
          retake.current = undefined;
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          void addPhotos(files, id);
        }}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss scanner error"
            onClick={() => setError('')}
          >
            <Icon name="X" size={16} />
          </button>
        </div>
      )}
      <nav className="scan-modes" aria-label="Document type">
        {scanModes.map((item) => (
          <button
            key={item.id}
            aria-pressed={mode === item.id}
            disabled={!!busy}
            title={item.hint}
            onClick={() => chooseMode(item.id)}
          >
            <Icon name={item.icon} size={19} />
            {item.name}
          </button>
        ))}
      </nav>
      {camera ? (
        <ScanCamera
          client={client}
          mode={mode}
          count={pages.length}
          onCapture={(blob) => addPhotos([blob])}
          onClose={() => setCamera(false)}
          onImport={() => {
            retake.current = undefined;
            nativeCamera.current?.click();
          }}
        />
      ) : (
        <div className="scan-add-row">
          <div>
            <button className="button" disabled={!!busy} onClick={() => setCamera(true)}>
              <Icon name="Camera" size={19} />
              Use camera
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => {
                retake.current = undefined;
                nativeCamera.current?.click();
              }}
            >
              Take a photo
            </button>
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={() => input.current?.click()}
            >
              <Icon name="ImagePlus" size={17} />
              Import photos
            </button>
          </div>
          <span>
            <Icon name="ShieldCheck" size={15} />
            Photos stay on this device
          </span>
        </div>
      )}
      {busy && (
        <div className="scan-progress" role="status">
          <span className="spinner" />
          {busy}
          {busy === 'Creating your PDF…' && (
            <>
              <progress value={progress} max={1} />
              <button
                className="button secondary"
                onClick={() => {
                  controller.current?.abort();
                  setNotice('Export canceled. Your scans are still here.');
                }}
              >
                Cancel export
              </button>
            </>
          )}
        </div>
      )}
      {!camera && current ? (
        <div className="scan-review">
          <aside className="scan-pages" aria-label="Scanned pages">
            <div>
              <h2>Your scans</h2>
              <span>{pages.length}/40</span>
            </div>
            <p>Drag to reorder, or use the arrows.</p>
            <ol>
              {pages.map((page, index) => (
                <li
                  key={page.id}
                  draggable={!busy}
                  onDragStart={(e) => {
                    drag.current = page.id;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', page.id);
                  }}
                  onDragOver={(e) => {
                    if (drag.current) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag.current)
                      movePage(
                        drag.current,
                        index - pages.findIndex((item) => item.id === drag.current),
                      );
                    drag.current = undefined;
                  }}
                  onDragEnd={() => {
                    drag.current = undefined;
                  }}
                  className={current.id === page.id ? 'current' : ''}
                >
                  <button
                    disabled={!!busy}
                    aria-current={current.id === page.id ? 'page' : undefined}
                    aria-label={`Review scan ${index + 1}`}
                    onClick={() => {
                      setSelected(page.id);
                      setCompare(false);
                    }}
                  >
                    <img src={page.thumbnail} alt="" draggable={false} />
                    <span>
                      {options.idLayout
                        ? `${Math.floor(index / 2) + 1} · ${index % 2 === 0 ? 'Front' : 'Back'}`
                        : `Page ${index + 1}`}
                    </span>
                  </button>
                  <div>
                    <button
                      className="icon-button"
                      aria-label={`Move scan ${index + 1} earlier`}
                      disabled={!!busy || index === 0}
                      onClick={() => movePage(page.id, -1)}
                    >
                      <Icon name="ChevronUp" size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Move scan ${index + 1} later`}
                      disabled={!!busy || index === pages.length - 1}
                      onClick={() => movePage(page.id, 1)}
                    >
                      <Icon name="ChevronDown" size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </aside>
          <section className="scan-preview-pane" aria-label="Scan review">
            <div className="scan-preview-toolbar">
              <div>
                <button
                  className={!crop ? 'active' : ''}
                  aria-pressed={!crop}
                  onClick={() => setCrop(false)}
                >
                  Preview
                </button>
                <button
                  className={crop ? 'active' : ''}
                  aria-pressed={crop}
                  onClick={() => setCrop(true)}
                >
                  <Icon name="Crop" size={16} />
                  Adjust edges
                </button>
              </div>
              <button
                className="icon-button"
                title="Rotate clockwise"
                aria-label="Rotate scan clockwise"
                disabled={!!busy}
                onClick={() => {
                  update({ rotation: (current.rotation + 1) % 4 });
                  setCrop(false);
                }}
              >
                <Icon name="RotateCw" size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Retake selected scan"
                title="Replace this photo"
                disabled={!!busy}
                onClick={() => {
                  retake.current = current.id;
                  nativeCamera.current?.click();
                }}
              >
                <Icon name="Camera" size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Delete selected scan"
                disabled={!!busy}
                onClick={remove}
              >
                <Icon name="Trash2" size={18} />
              </button>
            </div>
            <div className="scan-preview-surface" aria-busy={previewBusy}>
              {crop ? (
                <ScanCrop page={current} onChange={(quad) => update({ quad })} disabled={!!busy} />
              ) : compare ? (
                <img
                  className="scan-result-image"
                  src={current.sourceUrl}
                  alt="Original scan photo"
                />
              ) : readyPreview ? (
                <img
                  className="scan-result-image"
                  src={readyPreview.url}
                  alt={`Processed scan ${pages.indexOf(current) + 1}`}
                  data-current={readyPreview.key === previewKey}
                />
              ) : (
                <div className="scan-preview-loading">
                  <span className="spinner" />
                  Preparing preview…
                </div>
              )}
              {previewBusy && readyPreview && !crop && (
                <span className="scan-updating">Updating preview…</span>
              )}
            </div>
            <div className="scan-preview-footer">
              {crop ? (
                <>
                  <p>
                    Drag the four corners to the document edges. Arrow keys make small adjustments.
                  </p>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => update({ quad: fullQuad() })}
                  >
                    Use full photo
                  </button>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy('Finding document edges…');
                      try {
                        const found = await client.run({ action: 'detect', blob: current.source });
                        if (alive.current) {
                          setPages((previous) =>
                            previous.map((p) =>
                              p.id === current.id
                                ? { ...p, quad: found.quad, detected: found.detected }
                                : p,
                            ),
                          );
                          changed();
                          if (!found.detected)
                            setNotice('No clear edge was found. Drag the corners manually.');
                        }
                      } catch (cause) {
                        if (alive.current) setError((cause as Error).message);
                      } finally {
                        if (alive.current) setBusy('');
                      }
                    }}
                  >
                    Detect edges
                  </button>
                  <button className="button" onClick={() => setCrop(false)}>
                    Done
                  </button>
                </>
              ) : (
                <>
                  <span>
                    {current.detected ? 'Edges detected' : 'Check the crop before exporting'} ·{' '}
                    {readyPreview
                      ? `${readyPreview.result.width} × ${readyPreview.result.height} preview`
                      : ''}
                  </span>
                  <button
                    className="button secondary"
                    aria-pressed={compare}
                    onClick={() => setCompare(!compare)}
                  >
                    {compare ? 'Show processed' : 'Compare original'}
                  </button>
                </>
              )}
            </div>
          </section>
          <aside className="scan-settings">
            <h2>Make it clear</h2>
            <p>Changes appear in the preview.</p>
            <div className="scan-filter-grid" role="group" aria-label="Scan color mode">
              {scanFilters.map((filter) => (
                <button
                  key={filter.id}
                  disabled={!!busy}
                  aria-pressed={current.filter === filter.id}
                  onClick={() => {
                    update({ filter: filter.id });
                    setCompare(false);
                    setCrop(false);
                  }}
                >
                  <span aria-hidden="true" className={`scan-filter-sample ${filter.id}`}>
                    Aa
                  </span>
                  {filter.name}
                </button>
              ))}
            </div>
            <label>
              Brightness <output>{current.brightness}</output>
              <input
                aria-label="Scan brightness"
                type="range"
                min={-50}
                max={50}
                value={current.brightness}
                disabled={!!busy}
                onChange={(e) => update({ brightness: Number(e.target.value) })}
              />
            </label>
            <label>
              Contrast <output>{current.contrast}</output>
              <input
                aria-label="Scan contrast"
                type="range"
                min={-40}
                max={60}
                value={current.contrast}
                disabled={!!busy}
                onChange={(e) => update({ contrast: Number(e.target.value) })}
              />
            </label>
            <div className="scan-setting-actions">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  update({
                    brightness: 0,
                    contrast: 0,
                    filter: mode === 'photo' ? 'original' : 'color',
                  })
                }
              >
                Reset color
              </button>
              <button
                className="button secondary"
                disabled={!!busy || pages.length < 2}
                onClick={() => {
                  const patch: ScanSettings = {
                    filter: current.filter,
                    brightness: current.brightness,
                    contrast: current.contrast,
                    rotation: 0,
                  };
                  setPages((previous) =>
                    previous.map((p) => ({ ...p, ...patch, rotation: p.rotation })),
                  );
                  changed();
                  setNotice('Color and brightness applied to all scans.');
                }}
              >
                Apply color to all
              </button>
            </div>
            <hr />
            <h2>Your PDF</h2>
            <label>
              File name
              <input
                aria-label="Scan PDF name"
                maxLength={100}
                value={options.name}
                disabled={!!busy}
                onChange={(e) => updateOptions({ name: e.target.value })}
              />
            </label>
            <label>
              Page size
              <select
                aria-label="Scan PDF page size"
                value={options.paper}
                disabled={!!busy || options.idLayout}
                onChange={(e) =>
                  updateOptions({ paper: e.target.value as ScanExportOptions['paper'] })
                }
              >
                <option value="a4">A4</option>
                <option value="letter">US Letter</option>
                <option value="fit">Fit each scan</option>
              </select>
            </label>
            <label>
              Quality
              <select
                aria-label="Scan PDF quality"
                value={options.quality}
                disabled={!!busy}
                onChange={(e) =>
                  updateOptions({ quality: e.target.value as ScanExportOptions['quality'] })
                }
              >
                <option value="high">High · sharper details</option>
                <option value="standard">Standard · smaller file</option>
              </select>
            </label>
            <label className="scan-check">
              <input
                type="checkbox"
                checked={options.idLayout}
                disabled={!!busy}
                onChange={(e) => updateOptions({ idLayout: e.target.checked })}
              />
              Pair ID front and back on one A4 sheet
            </label>
            {options.idLayout && (
              <p className="scan-note">
                Cards fit within 85.6 × 54 mm on the PDF. Print at actual size.{' '}
                {pages.length % 2 ? 'The last card has a front only; add its back if needed.' : ''}
              </p>
            )}
            <p className="scan-note">
              Scans are image PDFs. Open in the editor to add text, highlights or a signature.
            </p>
            {result &&
              typeof navigator.share === 'function' &&
              navigator.canShare?.({
                files: [
                  new File([new Uint8Array(result.bytes)], result.name, { type: result.mime }),
                ],
              }) && (
                <button className="button secondary" onClick={() => void share()}>
                  <Icon name="Share2" size={17} />
                  Share PDF
                </button>
              )}
          </aside>
        </div>
      ) : !camera ? (
        <section className="scan-empty">
          <Icon name="ScanLine" size={52} />
          <h2>Turn your paperwork into a clear PDF.</h2>
          <p>
            Capture up to 40 pages in a batch, then review, straighten and arrange them. You can
            also import photos already on your device.
          </p>
          <div>
            <span>
              <Icon name="Crop" />
              Correct perspective
            </span>
            <span>
              <Icon name="Contrast" />
              Clean black & white
            </span>
            <span>
              <Icon name="ContactRound" />
              ID front & back
            </span>
          </div>
        </section>
      ) : null}
      <p className="scan-notice" role="status">
        {notice}
      </p>
      {pages.length > 0 && !camera && (
        <button
          className="scan-clear"
          disabled={!!busy}
          onClick={() => {
            if (
              window.confirm('Clear all scans? Download your PDF first if you want to keep it.')
            ) {
              pages.forEach((p) => {
                release(p.sourceUrl);
                release(p.thumbnail);
              });
              setPages([]);
              setSelected('');
              setResult(undefined);
              if (preview) release(preview.url);
              setPreview(undefined);
              onDirty(false);
              setNotice('Scans cleared from this session.');
            }
          }}
        >
          Clear this scan session
        </button>
      )}
    </div>
  );
}
