import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage, canvasBytes } from './pdf';

export interface RasterSettings {
  gray: boolean;
  dpi: number;
  quality: number;
  format: 'jpg' | 'png';
}

export function grayscaleCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!,
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const value = Math.round(
      pixels.data[index] * 0.2126 +
        pixels.data[index + 1] * 0.7152 +
        pixels.data[index + 2] * 0.0722,
    );
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
  }
  ctx.putImageData(pixels, 0, 0);
}

export async function rasterPageBytes(
  doc: PDFDocumentProxy,
  index: number,
  settings: RasterSettings,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const canvas = await renderPage(doc, index, settings.dpi / 72, 18_000_000, signal);
  try {
    signal?.throwIfAborted();
    if (settings.gray) grayscaleCanvas(canvas);
    return await canvasBytes(canvas, settings.format, settings.quality);
  } finally {
    canvas.width = canvas.height = 1;
  }
}

// A document can have hundreds of thumbnails. Keep full-resolution raster work
// serial, and skip obsolete jobs before allocating their page-sized canvases.
let pending: Promise<unknown> = Promise.resolve();
export function queueRaster<T>(run: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => {}).then(run);
  pending = next.catch(() => {});
  return next;
}
