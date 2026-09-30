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
import ScanSheet from './ScanSheet';
import '../../scanner.css';
export interface ScannerProps {
  initialFiles: File[];
  startCamera: boolean;
  onDirty: (dirty: boolean) => void;
  onDocumentChange?: (open: boolean) => void;
  onOpen: (file: File) => void;
  onExit: () => void;
}
export default function Scanner({
  initialFiles,
  startCamera,
  onDirty,
  onDocumentChange,
  onOpen,
  onExit,
}: ScannerProps) {
  const [client] = useState(() => new ScannerClient()),
    [pages, setPages] = useState<ScanPage[]>([]),
    [selected, setSelected] = useState('');
  const [mode, setMode] = useState<ScanMode>('document'),
    [camera, setCamera] = useState(startCamera),
    [crop, setCrop] = useState(false),
    [compare, setCompare] = useState(false),
    [panel, setPanel] = useState<'filters' | 'pages' | 'settings' | null>(null),
    [automatic, setAutomatic] = useState(false);
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
        setCrop(false);
        setCompare(false);
        setPanel(null);
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
  function keepScanning(replace = false) {
    retake.current = replace ? current?.id : undefined;
    setPanel(null);
    setCrop(false);
    setCompare(false);
    setCamera(true);
  }
  async function detectEdges() {
    if (!current || busy) return;
    setBusy('Finding document edges…');
    try {
      const found = await client.run({ action: 'detect', blob: current.source });
      if (alive.current) {
        setPages((previous) =>
          previous.map((p) =>
            p.id === current.id ? { ...p, quad: found.quad, detected: found.detected } : p,
          ),
        );
        changed();
        if (!found.detected) setNotice('Drag the corners to the document edges.');
      }
    } catch (cause) {
      if (alive.current) setError((cause as Error).message);
    } finally {
      if (alive.current) setBusy('');
    }
  }
  useEffect(() => {
    if (panel !== 'filters' && !crop) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel(null);
        setCrop(false);
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [panel, crop]);
  return (
    <div className="scan-workspace" data-camera={camera}>
      <header className="scan-header">
        <button
          className="icon-button"
          aria-label="Exit scanner"
          title="Back to all tools"
          onClick={onExit}
        >
          <Icon name="ArrowLeft" />
        </button>
        <div className="scan-title">
          <h1>Scan to PDF</h1>
          <span>Rovty PDF · {scanModes.find((item) => item.id === mode)?.name}</span>
        </div>
        {!camera && (
          <button
            className="icon-button"
            aria-label="Scan settings"
            title="Document type, PDF settings and more"
            onClick={() => setPanel('settings')}
            disabled={!!busy}
          >
            <Icon name="SlidersHorizontal" />
          </button>
        )}
        {!camera && pages.length > 0 && (
          <button
            className="button scan-download"
            disabled={!!busy || previewBusy}
            onClick={() => void exportPdf()}
          >
            <Icon name="Download" size={18} />
            <span>Download PDF</span>
          </button>
        )}
        {camera && (
          <span className="scan-local">
            <Icon name="ShieldCheck" size={15} />
            <span>On your device</span>
          </span>
        )}
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
            <Icon name="X" size={18} />
          </button>
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
      {camera ? (
        <ScanCamera
          client={client}
          mode={mode}
          count={pages.length}
          automatic={automatic}
          onAutomaticChange={setAutomatic}
          onModeChange={chooseMode}
          onCapture={async (blob) => {
            const added = await addPhotos([blob], retake.current);
            if (added && alive.current) {
              retake.current = undefined;
              setCamera(false);
            }
            return added;
          }}
          onClose={() => {
            retake.current = undefined;
            setCamera(false);
          }}
          onImport={() => {
            retake.current = undefined;
            nativeCamera.current?.click();
          }}
        />
      ) : current ? (
        <section className="scan-review" aria-label="Scan review">
          <div className="scan-review-info">
            <button
              className="scan-page-switch"
              aria-label="Review and arrange scans"
              onClick={() => setPanel('pages')}
              disabled={!!busy}
            >
              <Icon name="Files" size={17} />
              Page {pages.indexOf(current) + 1} of {pages.length}
              <Icon name="ChevronDown" size={15} />
            </button>
            <span>
              {crop
                ? 'Drag corners to the edges'
                : current.detected
                  ? 'Edges corrected'
                  : mode === 'photo'
                    ? 'Original photo'
                    : 'Check edges with Crop'}
            </span>
            <button
              className="scan-compare"
              aria-pressed={compare}
              onClick={() => {
                setCompare(!compare);
                setCrop(false);
              }}
            >
              {compare ? 'Show processed' : 'Compare original'}
            </button>
          </div>
          <div className="scan-preview-surface" aria-busy={previewBusy}>
            <div className="scan-stage-content">
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
            </div>
            {previewBusy && readyPreview && !crop && (
              <span className="scan-updating">Updating…</span>
            )}
          </div>
          {panel === 'filters' && (
            <section className="scan-filter-panel scan-settings" aria-label="Scan filters">
              <div className="scan-panel-heading">
                <h2>Filters</h2>
                <button className="button secondary" onClick={() => setPanel(null)}>
                  Done
                </button>
              </div>
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
              <details className="scan-adjustments">
                <summary>Fine-tune brightness & contrast</summary>
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
              </details>
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
            </section>
          )}
          {crop ? (
            <footer className="scan-crop-actions">
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
                onClick={() => void detectEdges()}
              >
                Detect edges
              </button>
              <button className="button" onClick={() => setCrop(false)}>
                <Icon name="Check" size={18} />
                Done
              </button>
            </footer>
          ) : (
            <footer className="scan-review-actions">
              <div className="scan-edit-actions" role="group" aria-label="Edit this scan">
                <button
                  onClick={() => {
                    setCrop(true);
                    setCompare(false);
                    setPanel(null);
                  }}
                  disabled={!!busy}
                  aria-label="Crop scan"
                >
                  <Icon name="Crop" />
                  <span>Crop</span>
                </button>
                <button
                  aria-pressed={panel === 'filters'}
                  onClick={() => {
                    setPanel(panel === 'filters' ? null : 'filters');
                    setCompare(false);
                  }}
                  disabled={!!busy}
                >
                  <Icon name="Contrast" />
                  <span>Filters</span>
                </button>
                <button
                  aria-label="Rotate scan clockwise"
                  disabled={!!busy}
                  onClick={() => {
                    update({ rotation: (current.rotation + 1) % 4 });
                    setCompare(false);
                  }}
                >
                  <Icon name="RotateCw" />
                  <span>Rotate</span>
                </button>
                <button
                  aria-label="Delete selected scan"
                  disabled={!!busy}
                  onClick={() => {
                    remove();
                    setPanel(null);
                  }}
                >
                  <Icon name="Trash2" />
                  <span>Delete</span>
                </button>
              </div>
              <button
                className="button scan-continue"
                disabled={!!busy || pages.length >= 40}
                onClick={() => keepScanning()}
              >
                <Icon name="Camera" size={20} />
                Keep scanning
              </button>
            </footer>
          )}
        </section>
      ) : (
        <section className="scan-empty">
          <span className="scan-empty-icon">
            <Icon name="ScanLine" size={44} />
          </span>
          <h2>One page or a whole pile.</h2>
          <p>Capture a page, check the scan, then keep going.</p>
          <button className="button" disabled={!!busy} onClick={() => keepScanning()}>
            <Icon name="Camera" size={20} />
            Use camera
          </button>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() => input.current?.click()}
          >
            <Icon name="ImagePlus" size={18} />
            Import photos
          </button>
          <span className="scan-local">
            <Icon name="ShieldCheck" size={15} />
            Private · Free · No account
          </span>
        </section>
      )}
      <p className="sr-only" role="status">
        {notice}
      </p>
      {panel === 'pages' && (
        <ScanSheet title="Your scans" onClose={() => setPanel(null)}>
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
                      setPanel(null);
                      setCrop(false);
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
        </ScanSheet>
      )}
      {panel === 'settings' && (
        <ScanSheet title="Scan settings" onClose={() => setPanel(null)}>
          <div className="scan-settings">
            <h3>Document type</h3>
            <p>Document is ready for everyday paperwork.</p>
            <nav className="scan-modes" aria-label="Document type">
              {scanModes.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={mode === item.id}
                  title={item.hint}
                  disabled={!!busy}
                  onClick={() => chooseMode(item.id)}
                >
                  <Icon name={item.icon} size={19} />
                  {item.name}
                </button>
              ))}
            </nav>
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

            <hr />
            <h3>Add & manage</h3>
            <div className="scan-more-actions">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => input.current?.click()}
              >
                <Icon name="ImagePlus" size={18} />
                Import photos
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
              {current && (
                <>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => keepScanning(true)}
                  >
                    <Icon name="Camera" size={18} />
                    Retake selected scan
                  </button>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => void exportPdf(true)}
                  >
                    Open in editor
                    <Icon name="FilePenLine" size={18} />
                  </button>
                </>
              )}
            </div>
            {pages.length > 0 && (
              <button
                className="scan-clear"
                disabled={!!busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Clear all scans? Download your PDF first if you want to keep it.',
                    )
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
                    setPanel(null);
                  }
                }}
              >
                Clear this scan session
              </button>
            )}
            <button className="button scan-settings-done" onClick={() => setPanel(null)}>
              Done
            </button>
          </div>
        </ScanSheet>
      )}
    </div>
  );
}
