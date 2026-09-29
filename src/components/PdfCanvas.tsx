import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf } from '../lib/pdf';
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
}: {
  doc: PDFDocumentProxy;
  index: number;
  rotation?: number;
  width?: number;
  onError?: (error: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true,
      task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined;
    setLoading(true);
    void doc
      .getPage(index + 1)
      .then((page) => {
        if (!active || !canvas.current) return;
        const view = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 }),
          scale =
            Math.min(2, width / view.width) *
            (devicePixelRatio > 1 ? Math.min(devicePixelRatio, 2) : 1);
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
        const target = canvas.current;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        task = page.render({ canvas: target, viewport, background: '#ffffff' });
        return task.promise;
      })
      .then(() => {
        if (active) setLoading(false);
      })
      .catch((error) => {
        if (active && error?.name !== 'RenderingCancelledException') {
          setLoading(false);
          onError?.('This page could not be rendered. Try opening the original file again.');
        }
      });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [doc, index, rotation, width, onError]);
  return (
    <>
      <canvas ref={canvas} className="pdf-canvas" aria-label={`PDF page ${index + 1}`} />
      {loading && (
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
}: {
  source: SourceFile;
  index: number;
  rotation: number;
  pool: DocumentPool;
}) {
  const root = useRef<HTMLDivElement>(null),
    [visible, setVisible] = useState(false),
    [doc, setDoc] = useState<PDFDocumentProxy>();
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '250px' },
    );
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
      {doc ? (
        <PdfCanvas doc={doc} index={index} rotation={rotation} width={180} />
      ) : (
        <span className="thumbnail-placeholder">{index + 1}</span>
      )}
    </div>
  );
}
