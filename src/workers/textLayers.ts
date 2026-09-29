import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { Mark, PageInfo, TextLayers } from '../lib/types';
import { groupTextLines, textSources } from '../lib/textBlocks';
import { transformPoint } from '../lib/utils';
import { readText } from './text';

/** Render once at drag start; moving the transparent text layer then needs no PDF work. */
export function renderTextLayers(
  p: WrappedPdfiumModule,
  page: number,
  mark: Mark,
  info: PageInfo,
  requestedScale: number,
): TextLayers {
  const items = readText(p, page);
  const candidates = [...groupTextLines(items), ...items];
  const paths = new Set<string>();
  for (const [index, text] of (mark.text || '').split('\n').entries()) {
    if (!text.trim()) continue;
    const matches = candidates.filter((item) => item.text.trimEnd() === text.trimEnd());
    const distance = (item: (typeof items)[number]) => {
      const a = transformPoint(info.transform, item.bounds[0], item.bounds[1]);
      const b = transformPoint(info.transform, item.bounds[2], item.bounds[3]);
      return Math.hypot(
        Math.min(a[0], b[0]) - mark.x,
        Math.min(a[1], b[1]) - mark.y - index * mark.fontSize * 1.2,
      );
    };
    matches.sort((a, b) => distance(a) - distance(b));
    if (!matches[0] || distance(matches[0]) > mark.fontSize * 4)
      throw new Error('This line could not be previewed for moving. Try selecting it again.');
    for (const item of textSources(matches[0])) paths.add(item.path.join('.'));
  }
  if (!paths.size) throw new Error('Select a line containing text to move it.');
  const ancestors = new Set<string>();
  for (const path of paths) {
    const parts = path.split('.');
    for (let i = 1; i < parts.length; i++) ancestors.add(parts.slice(0, i).join('.'));
  }
  const scale = Math.min(
    Math.max(0.25, Number.isFinite(requestedScale) ? requestedScale : 1),
    Math.sqrt(4_000_000 / (info.width * info.height)),
  );
  const width = Math.max(1, Math.floor(info.width * scale));
  const height = Math.max(1, Math.floor(info.height * scale));
  const bitmap = p.FPDFBitmap_Create(width, height, 1);
  const ptr = p.pdfium.wasmExports.malloc(4);
  const states: { object: number; active: boolean; selected: boolean; ancestor: boolean }[] = [];
  try {
    if (!bitmap || !ptr) throw new Error('Not enough browser memory for a moving text preview.');
    const walk = (parent: number, path: number[]) => {
      const count = path.length
        ? p.FPDFFormObj_CountObjects(parent)
        : p.FPDFPage_CountObjects(parent);
      for (let i = 0; i < count; i++) {
        const object = path.length
          ? p.FPDFFormObj_GetObject(parent, i)
          : p.FPDFPage_GetObject(parent, i);
        const next = [...path, i],
          key = next.join('.');
        if (!p.FPDFPageObj_GetIsActive(object, ptr))
          throw new Error('This page could not be previewed.');
        states.push({
          object,
          active: !!p.pdfium.getValue(ptr, 'i32'),
          selected: paths.has(key),
          ancestor: ancestors.has(key),
        });
        if (ancestors.has(key)) walk(object, next);
      }
    };
    walk(page, []);
    const render = (foreground: boolean) => {
      for (const state of states)
        if (
          !p.FPDFPageObj_SetIsActive(
            state.object,
            state.active && (foreground ? state.selected || state.ancestor : !state.selected),
          )
        )
          throw new Error('This page could not be previewed.');
      p.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, foreground ? 0 : 0xffffffff);
      p.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, foreground ? 0 : 1);
      const start = p.FPDFBitmap_GetBuffer(bitmap),
        stride = p.FPDFBitmap_GetStride(bitmap);
      const heap = (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const from = start + y * stride + x * 4,
            to = (y * width + x) * 4;
          pixels[to] = heap[from + 2];
          pixels[to + 1] = heap[from + 1];
          pixels[to + 2] = heap[from];
          pixels[to + 3] = heap[from + 3];
        }
      return pixels;
    };
    return { width, height, background: render(false), foreground: render(true) };
  } finally {
    for (const state of states) p.FPDFPageObj_SetIsActive(state.object, state.active);
    if (ptr) p.pdfium.wasmExports.free(ptr);
    if (bitmap) p.FPDFBitmap_Destroy(bitmap);
  }
}
