import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageRef, ProcessOptions, SourceFile, Tool } from '../lib/types';
import { processPdf } from '../lib/operations';
import { imagePageLayout, splitPageGroups } from '../lib/utilityLayout';
import { humanError, parseRange } from '../lib/utils';
import { openPdf } from '../lib/pdf';
import type { RasterSettings } from '../lib/rasterPreview';
import { DocumentPool, PdfCanvas } from './PdfCanvas';
import { Icon } from './Icon';

interface PreviewContext {
  refs: PageRef[];
  previewDoc?: PDFDocumentProxy;
  raster?: RasterSettings;
  groups: Map<string, number>;
  onSelect: (index: number) => void;
}

export function ImagePagePreview({ file, options }: { file: File; options: ProcessOptions }) {
  const [image, setImage] = useState<{ url: string; width: number; height: number }>();
  const [error, setError] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file),
      img = new Image();
    let active = true;
    setImage(undefined);
    setError('');
    img.onload = () => {
      if (active) setImage({ url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (active) setError('This image could not be previewed.');
    };
    img.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  let layout;
  try {
    if (image) layout = imagePageLayout(image.width, image.height, options);
  } catch (reason) {
    return <p role="alert">{humanError(reason)}</p>;
  }
  return (
    <div
      className="image-pdf-preview"
      data-ready={!!layout}
      style={{ aspectRatio: layout ? `${layout.width}/${layout.height}` : '0.707' }}
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : image && layout ? (
        <img
          alt={file.name}
          src={image.url}
          style={{
            left: `${(layout.x / layout.width) * 100}%`,
            top: `${(layout.y / layout.height) * 100}%`,
            width: `${(layout.drawnWidth / layout.width) * 100}%`,
            height: `${(layout.drawnHeight / layout.height) * 100}%`,
          }}
        />
      ) : (
        <span className="spinner" />
      )}
    </div>
  );
}

function LargePdfPage({
  source,
  index,
  rotation,
  previewDoc,
  raster,
  pool,
  width,
  onError,
}: {
  source: SourceFile;
  index: number;
  rotation: number;
  previewDoc?: PDFDocumentProxy;
  raster?: RasterSettings;
  pool: DocumentPool;
  width: number;
  onError: (message: string) => void;
}) {
  const [original, setOriginal] = useState<PDFDocumentProxy>();
  useEffect(() => {
    let active = true;
    setOriginal(undefined);
    void pool
      .get(source)
      .then((doc) => {
        if (active) setOriginal(doc);
      })
      .catch((e) => {
        if (active) onError(humanError(e));
      });
    return () => {
      active = false;
    };
  }, [source, pool, onError]);
  const doc = previewDoc || original;
  return doc ? (
    <PdfCanvas
      doc={doc}
      index={index}
      rotation={rotation}
      width={width}
      raster={raster}
      onError={onError}
      label="Live PDF page preview"
    />
  ) : (
    <span className="spinner" />
  );
}

export default function LivePreview({
  tool,
  files,
  images,
  refs,
  options,
  pool,
  children,
}: {
  tool: Tool;
  files: SourceFile[];
  images: File[];
  refs: PageRef[];
  options: ProcessOptions;
  pool: DocumentPool;
  children: (context: PreviewContext) => ReactNode;
}) {
  const [settled, setSettled] = useState(options);
  const [prepared, setPrepared] = useState<{ key: string; doc: PDFDocumentProxy }>();
  const [preparing, setPreparing] = useState(false),
    [error, setError] = useState(''),
    [renderError, setRenderError] = useState('');
  const [selected, setSelected] = useState(0),
    [pageView, setPageView] = useState(
      !['merge', 'organize', 'rotate', 'split', 'extract', 'delete'].includes(tool.id),
    );
  const [original, setOriginal] = useState(false),
    [zoom, setZoom] = useState('fit'),
    [width, setWidth] = useState(700);
  const viewport = useRef<HTMLDivElement>(null),
    pending = useRef<Promise<unknown>>(Promise.resolve());
  const vector = ['watermark', 'page-numbers', 'crop', 'flatten'].includes(tool.id);
  const key = JSON.stringify([tool.id, files[0]?.id, settled]);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(options), 200);
    return () => clearTimeout(timer);
  }, [options]);
  useEffect(
    () => () => {
      void prepared?.doc.loadingTask.destroy();
    },
    [prepared],
  );
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setError('');
    setRenderError('');
    if (!vector || !files.length) {
      setPrepared(undefined);
      setPreparing(false);
      return;
    }
    setPreparing(true);
    const job = pending.current
      .catch(() => {})
      .then(async () => {
        controller.signal.throwIfAborted();
        const output = await processPdf(tool.id, files, refs, settled, () => {}, controller.signal);
        controller.signal.throwIfAborted();
        const doc = await openPdf(output.bytes);
        if (active) setPrepared({ key, doc });
        else await doc.loadingTask.destroy();
      })
      .catch((reason) => {
        if (active) setError(humanError(reason));
      })
      .finally(() => {
        if (active) setPreparing(false);
      });
    pending.current = job;
    return () => {
      active = false;
      controller.abort();
    };
  }, [key, vector]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(100, entry.contentRect.width - 32)),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [pageView, key, error]);
  const model = useMemo(() => {
    try {
      const source = files[0],
        groups = new Map<string, number>();
      if (!source) return { refs: [], groups, error: '' };
      if (tool.id === 'split') {
        const selected = splitPageGroups(source.pages.length, options).flatMap((indices, group) =>
          indices.map((index, offset) => {
            const ref = { id: `split-${group}-${offset}`, fileId: source.id, index, rotation: 0 };
            groups.set(ref.id, group + 1);
            return ref;
          }),
        );
        return { refs: selected, groups, error: '' };
      }
      if (['extract', 'delete', 'pdf-to-images', 'text'].includes(tool.id)) {
        if (tool.id === 'delete' && !options.range.trim()) return { refs, groups, error: '' };
        const selected = parseRange(options.range, source.pages.length, tool.id !== 'delete');
        const indices =
          tool.id === 'delete'
            ? source.pages.map((_, index) => index).filter((index) => !selected.includes(index))
            : selected;
        if (!indices.length) throw new Error('Keep at least one page in the document.');
        if (tool.id === 'pdf-to-images' && indices.length > 100)
          throw new Error('Choose up to 100 pages for image export.');
        return {
          refs: indices.map((index) => refs.find((ref) => ref.index === index)!),
          groups,
          error: '',
        };
      }
      return { refs, groups, error: '' };
    } catch (reason) {
      return { refs: [], groups: new Map<string, number>(), error: humanError(reason) };
    }
  }, [files, refs, tool.id, options]);
  const raster = useMemo<RasterSettings | undefined>(
    () =>
      ['grayscale', 'compress', 'pdf-to-images'].includes(tool.id)
        ? {
            gray: tool.id === 'grayscale',
            dpi: settled.dpi,
            quality: settled.quality,
            format: tool.id === 'pdf-to-images' ? settled.format : 'jpg',
          }
        : undefined,
    [tool.id, settled.dpi, settled.quality, settled.format],
  );
  const count = tool.id === 'images-to-pdf' ? images.length : model.refs.length;
  const position = Math.min(selected, Math.max(0, count - 1)),
    ref = model.refs[position];
  const updating = options !== settled || preparing || (vector && !error && prepared?.key !== key);
  const previewDoc = original ? undefined : prepared?.doc,
    rasterView = original ? undefined : raster;
  const failure = model.error || error || renderError;
  useEffect(() => setRenderError(''), [key, position]);
  let note = 'Preview updates as you change settings. Files stay on this device.';
  if (tool.id === 'compress')
    note =
      'Compression preview. If compression makes the file larger, the download keeps your original PDF.';
  if (tool.id === 'protect')
    note = 'Password settings apply to the download. The page appearance stays the same.';
  if (tool.id === 'metadata')
    note =
      'Title and author settings apply to the document properties. The page appearance stays the same.';
  if (tool.id === 'text')
    note = 'Showing the pages selected for text extraction, in download order.';
  if (tool.id === 'split') note = 'Each numbered group becomes a separate PDF in your download.';
  if (tool.id === 'delete' && !options.range.trim())
    note = 'Enter the pages to remove. All original pages are shown until you choose.';
  return (
    <div className="live-tool-preview" aria-busy={updating}>
      <div className="live-preview-controls">
        <div role="group" aria-label="Preview view">
          <button aria-pressed={pageView} onClick={() => setPageView(true)}>
            Page view
          </button>
          <button aria-pressed={!pageView} onClick={() => setPageView(false)}>
            Thumbnails
          </button>
        </div>
        {(vector || raster) && (
          <label>
            <input
              type="checkbox"
              checked={original}
              onChange={(event) => setOriginal(event.target.checked)}
            />{' '}
            Show original
          </label>
        )}
      </div>
      <p className="live-preview-status" role="status">
        {updating
          ? 'Updating preview…'
          : original
            ? 'Original preview. Your settings apply to the download.'
            : 'Live preview'}
        <span>{note}</span>
      </p>
      {failure ? (
        <p className="live-preview-error" role="alert">
          {failure}
        </p>
      ) : (
        <>
          {pageView && count > 0 && (
            <>
              <div className="live-page-navigation">
                <button
                  aria-label="Previous preview page"
                  disabled={position === 0}
                  onClick={() => setSelected(position - 1)}
                >
                  <Icon name="ChevronLeft" size={18} />
                </button>
                <label>
                  Page{' '}
                  <input
                    aria-label="Preview page"
                    type="number"
                    min={1}
                    max={count}
                    value={position + 1}
                    onChange={(event) =>
                      setSelected(
                        Math.max(0, Math.min(count - 1, (Number(event.target.value) || 1) - 1)),
                      )
                    }
                  />{' '}
                  of {count}
                </label>
                <button
                  aria-label="Next preview page"
                  disabled={position === count - 1}
                  onClick={() => setSelected(position + 1)}
                >
                  <Icon name="ChevronRight" size={18} />
                </button>
                <select
                  aria-label="Preview zoom"
                  value={zoom}
                  onChange={(event) => setZoom(event.target.value)}
                >
                  <option value="fit">Fit width</option>
                  <option value="0.75">75%</option>
                  <option value="1">100%</option>
                  <option value="1.5">150%</option>
                  <option value="2">200%</option>
                </select>
              </div>
              <div
                className={`live-page-viewport ${updating ? 'preview-updating' : ''}`}
                ref={viewport}
              >
                <div
                  className="live-page-sheet"
                  style={{
                    width:
                      zoom === 'fit'
                        ? width
                        : (ref
                            ? files.find((file) => file.id === ref.fileId)!.pages[ref.index].width
                            : 595) * Number(zoom),
                  }}
                >
                  {tool.id === 'images-to-pdf' ? (
                    <ImagePagePreview file={images[position]} options={options} />
                  ) : (
                    ref && (
                      <LargePdfPage
                        source={files.find((file) => file.id === ref.fileId)!}
                        index={ref.index}
                        rotation={ref.rotation}
                        previewDoc={previewDoc}
                        raster={rasterView}
                        pool={pool}
                        width={
                          zoom === 'fit'
                            ? width
                            : files.find((file) => file.id === ref.fileId)!.pages[ref.index].width *
                              Number(zoom)
                        }
                        onError={setRenderError}
                      />
                    )
                  )}
                </div>
              </div>
            </>
          )}
          <div
            className={`${pageView ? 'live-preview-thumbnails' : ''} ${updating ? 'preview-updating' : ''}`}
          >
            {children({
              refs: model.refs,
              previewDoc,
              raster: rasterView,
              groups: model.groups,
              onSelect: (index) => {
                setSelected(index);
                setPageView(true);
              },
            })}
          </div>
        </>
      )}
    </div>
  );
}
