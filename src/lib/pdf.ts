import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PageInfo, SourceFile } from './types';
import { uid } from './types';
import { native } from './native';

GlobalWorkerOptions.workerSrc = workerUrl;
export const MAX_FILE_SIZE = 80 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 160 * 1024 * 1024;
export async function openPdf(bytes: Uint8Array, password?: string) {
  const task = getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    enableXfa: false,
    useSystemFonts: false,
  });
  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}
export async function loadSource(file: File, password = ''): Promise<SourceFile> {
  if (!file.size) throw new Error(`${file.name} is empty.`);
  if (file.size > MAX_FILE_SIZE)
    throw new Error(
      `${file.name} is larger than 80 MB. Choose a smaller file to fit browser memory.`,
    );
  let bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (!header.includes('%PDF-'))
    throw new Error(`${file.name} is not a PDF. Use Images to PDF for image files.`);
  const { encrypted } = await native<{ encrypted: boolean }>('inspect', bytes, { password });
  if (encrypted) bytes = await native('unlock', bytes, { password });
  const doc = await openPdf(bytes);
  try {
    if (doc.numPages > 1000)
      throw new Error('Choose a PDF with 1,000 pages or fewer to fit browser memory.');
    const pages: PageInfo[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i),
        viewport = page.getViewport({ scale: 1 });
      pages.push({
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
        transform: viewport.transform,
      });
    }
    return { id: uid(), name: file.name, bytes, size: file.size, pages };
  } finally {
    await doc.loadingTask.destroy();
  }
}
export async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  scale = 1.5,
  maxPixels = 18_000_000,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const page = await doc.getPage(index + 1);
  const initial = page.getViewport({ scale });
  if (initial.width * initial.height > maxPixels)
    scale *= Math.sqrt(maxPixels / (initial.width * initial.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  signal?.throwIfAborted();
  const task = page.render({ canvas, viewport, background: '#ffffff' });
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
  } catch (error) {
    canvas.width = canvas.height = 1;
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  return canvas;
}
export async function canvasBytes(
  canvas: HTMLCanvasElement,
  format: 'jpg' | 'png',
  quality = 0.85,
) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('This page could not be converted to an image.')),
      format === 'jpg' ? 'image/jpeg' : 'image/png',
      quality,
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
export async function demoFile() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica),
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(1, 1, 1) });
    page.drawText('ROVTY / STUDIO NOTES', {
      x: 52,
      y: 775,
      size: 10,
      font: bold,
      color: rgb(0.35, 0.35, 0.35),
    });
    page.drawText(['A small idea.', 'Room to make it yours.', 'Ready when you are.'][i], {
      x: 52,
      y: 695,
      size: 32,
      font: bold,
      color: rgb(0.09, 0.09, 0.1),
    });
    const lines = [
      'Good things start with a little space to think.',
      'This is your sample PDF. Try editing this text, adding a note,',
      'or highlighting something you want to remember.',
      '',
      'PROJECT          The everyday collection',
      'PREPARED BY      Alex Morgan',
      'DATE             September 2026',
    ];
    lines.forEach((text, j) =>
      page.drawText(text, { x: 52, y: 640 - j * 28, size: 12, font, color: rgb(0.3, 0.3, 0.32) }),
    );
    page.drawRectangle({ x: 52, y: 290, width: 491, height: 96, color: rgb(0.92, 0.94, 0.88) });
    page.drawText('A little less paperwork. A little more possibility.', {
      x: 72,
      y: 342,
      size: 14,
      font: bold,
      color: rgb(0.18, 0.23, 0.16),
    });
    page.drawText('Edit freely. This sample is generated on your device.', {
      x: 72,
      y: 317,
      size: 10,
      font,
      color: rgb(0.35, 0.4, 0.32),
    });
    if (i === 0) {
      page.drawText('Your name', { x: 52, y: 235, size: 11, font });
      const field = doc.getForm().createTextField('Your name');
      field.addToPage(page, { x: 52, y: 185, width: 285, height: 30, borderWidth: 1 });
      const checkbox = doc.getForm().createCheckBox('Approved');
      checkbox.addToPage(page, { x: 52, y: 138, width: 14, height: 14 });
      page.drawText('Approved', { x: 76, y: 141, size: 11, font });
    }
    page.drawText(`${i + 1} / 3`, { x: 520, y: 45, size: 10, font, color: rgb(0.45, 0.45, 0.45) });
  }
  return new File([new Uint8Array(await doc.save())], 'rovty-sample.pdf', {
    type: 'application/pdf',
  });
}
