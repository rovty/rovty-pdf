import { useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf } from '../lib/pdf';
import { queueRaster, rasterPageBytes, type RasterSettings } from '../lib/rasterPreview';
import type { SourceFile } from '../lib/types';

export class DocumentPool {
  private docs = new Map<string, Promise<PDFDocumentProxy>>();
  get(source: SourceFile) {
    let doc = this.docs.get(source.id);
    if (!doc) {
      doc = openPdf(source.bytes);
      this.docs.set(source.id, doc);
    }
    return doc;
  }
  destroy() {
    for (const doc of this.docs.values())
      void doc.then((value) => value.loadingTask.destroy()).catch(() => {});
    this.docs.clear();
  }
}
export function PdfCanvas({
  doc,
  index,
  rotation = 0,
  width = 700,
  onError,
  onRendered,
  label,
  raster,
}: {
  doc: PDFDocumentProxy;
  index: number;
  rotation?: number;
  width?: number;
  onError?: (error: string) => void;
  onRendered?: (doc: PDFDocumentProxy, index: number) => void;
  label?: string;
  raster?: RasterSettings;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderKey = useMemo(
    () => ({ doc, index, rotation, width, raster }),
    [doc, index, rotation, width, raster],
  );
  const [rendered, setRendered] = useState<typeof renderKey>();
  const loading = rendered !== renderKey;
  useEffect(() => {
    let active = true,
      task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    const controller = new AbortController();
    if (raster) {
      void queueRaster(async () => {
        controller.signal.throwIfAborted();
        const bytes = await rasterPageBytes(doc, index, raster, controller.signal);
        controller.signal.throwIfAborted();
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], {
            type: raster.format === 'jpg' ? 'image/jpeg' : 'image/png',
          }),
        );
        try {
          if (!active || !canvas.current) return;
          const target = canvas.current;
          target.width = Math.ceil(
            Math.min(
              width * Math.min(devicePixelRatio || 1, 2),
              Math.sqrt((18_000_000 * bitmap.width) / bitmap.height),
            ),
          );
          target.height = Math.ceil((target.width * bitmap.height) / bitmap.width);
          target.getContext('2d')!.drawImage(bitmap, 0, 0, target.width, target.height);
          setRendered(renderKey);
          onRendered?.(doc, index);
        } finally {
          bitmap.close();
        }
      }).catch(() => {
        if (active) {
          setRendered(renderKey);
          onError?.('This page preview could not be rendered. Try a lower resolution.');
        }
      });
      return () => {
        active = false;
        controller.abort();
      };
    }
    void Promise.resolve()
      .then(() => (active ? doc.getPage(index + 1) : undefined))
      .then((page) => {
        if (!active || !canvas.current || !page) return;
        const view = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 }),
          scale = Math.min(
            (width / view.width) * Math.min(devicePixelRatio || 1, 2),
            Math.sqrt(18_000_000 / (view.width * view.height)),
          );
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
        // Render offscreen. Resizing a visible canvas clears it immediately,
        // which used to flash a blank page on every text edit and zoom change.
        const target = document.createElement('canvas');
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        task = page.render({ canvas: target, viewport, background: '#ffffff' });
        return task.promise
          .then(() => {
            if (!active || !canvas.current) return;
            const visible = canvas.current;
            visible.width = target.width;
            visible.height = target.height;
            visible.getContext('2d')!.drawImage(target, 0, 0);
          })
          .finally(() => {
            target.width = target.height = 0;
          });
      })
      .then(() => {
        if (active) {
          setRendered(renderKey);
          onRendered?.(doc, index);
        }
      })
      .catch((error) => {
        if (active && error?.name !== 'RenderingCancelledException') {
          setRendered(renderKey);
          onError?.('This page could not be rendered. Try opening the original file again.');
        }
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [doc, index, rotation, width, onError, onRendered, raster]);
  return (
    <>
      <canvas
        ref={canvas}
        className="pdf-canvas"
        data-ready={!loading}
        aria-label={label || `PDF page ${index + 1}`}
      />
      {loading && (!rendered || rendered.index !== index || rendered.rotation !== rotation) && (
        <span className="page-loading">
          <span className="spinner" />
        </span>
      )}
    </>
  );
}
export function Thumbnail({
  source,
  index,
  rotation,
  pool,
  previewDoc,
  raster,
}: {
  source: SourceFile;
  index: number;
  rotation: number;
  pool: DocumentPool;
  previewDoc?: PDFDocumentProxy;
  raster?: RasterSettings;
}) {
  const root = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [doc, setDoc] = useState<PDFDocumentProxy>();
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '250px',
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let alive = true;
    if (visible)
      void pool
        .get(source)
        .then((doc) => {
          if (alive) setDoc(doc);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source, pool, visible]);
  return (
    <div ref={root} className="thumbnail-sheet">
      {visible && (previewDoc || doc) ? (
        <PdfCanvas
          doc={(previewDoc || doc)!}
          index={index}
          rotation={rotation}
          width={180}
          raster={raster}
        />
      ) : (
        <span className="thumbnail-placeholder">{index + 1}</span>
      )}
    </div>
  );
}
