import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { FontEffectsError } from '../lib/fontEffects';

type Color = [number, number, number, number];
type Param = { key: string; value: number | Uint8Array };
type ContentMark = { name: string; params: Param[] };

function heap(p: WrappedPdfiumModule) {
  return (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

// The page boundary already clips all painting. Only simple rectangular clips
// enclosing that entire boundary are redundant. Never approximate a mask by its
// bounding box: holes, curves and smaller rectangles must remain protected.
function redundantPageClip(p: WrappedPdfiumModule, page: number, clip: number, ptr: number) {
  if (!p.FPDF_GetPageBoundingBox(page, ptr)) return false;
  const [left, top, right, bottom] = [0, 4, 8, 12].map((i) => p.pdfium.getValue(ptr + i, 'float'));
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || top <= bottom)
    return false;
  const paths = p.FPDFClipPath_CountPaths(clip);
  if (paths < 0 || paths > 64) return false;
  for (let i = 0; i < paths; i++) {
    const count = p.FPDFClipPath_CountPathSegments(clip, i);
    if (count !== 4 && count !== 5) return false;
    const points: [number, number][] = [];
    for (let j = 0; j < count; j++) {
      const segment = p.FPDFClipPath_GetPathSegment(clip, i, j);
      // PDFium: LINETO=0, BEZIERTO=1, MOVETO=2.
      if (
        !segment ||
        p.FPDFPathSegment_GetType(segment) !== (j === 0 ? 2 : 0) ||
        !p.FPDFPathSegment_GetPoint(segment, ptr, ptr + 4)
      )
        return false;
      points.push([p.pdfium.getValue(ptr, 'float'), p.pdfium.getValue(ptr + 4, 'float')]);
      if (j < count - 1 && p.FPDFPathSegment_GetClose(segment)) return false;
    }
    if (count === 5) {
      const last = points.pop()!;
      if (last[0] !== points[0][0] || last[1] !== points[0][1]) return false;
    }
    if (!points.flat().every(Number.isFinite)) return false;
    for (let j = 0; j < 4; j++) {
      const a = points[j],
        b = points[(j + 1) % 4];
      if ((a[0] === b[0]) === (a[1] === b[1])) return false;
    }
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    if (
      new Set(xs).size !== 2 ||
      new Set(ys).size !== 2 ||
      new Set(points.map((point) => point.join(','))).size !== 4 ||
      Math.min(...xs) > left ||
      Math.max(...xs) < right ||
      Math.min(...ys) > bottom ||
      Math.max(...ys) < top
    )
      return false;
  }
  return true;
}

function readMarks(p: WrappedPdfiumModule, object: number, ptr: number) {
  const marks: ContentMark[] = [];
  const count = p.FPDFPageObj_CountMarks(object);
  let remaining = 1024 * 1024;
  const bytes = (read: (buffer: number, length: number) => boolean, unicode = false) => {
    if (!read(0, 0)) throw new FontEffectsError('unreadable document tags');
    const length = p.pdfium.getValue(ptr, 'i32');
    if (length < 0 || length > 65536 || length > remaining || (unicode && length % 2))
      throw new FontEffectsError('document tags that are too large to copy');
    remaining -= length;
    const buffer = p.pdfium.wasmExports.malloc(Math.max(1, length));
    if (!buffer) throw new Error('Not enough browser memory to preserve document tags.');
    try {
      if (!read(buffer, length) || p.pdfium.getValue(ptr, 'i32') !== length)
        throw new FontEffectsError('unreadable document tags');
      return heap(p).slice(buffer, buffer + length);
    } finally {
      p.pdfium.wasmExports.free(buffer);
    }
  };
  const string = (read: (buffer: number, length: number) => boolean) => {
    const value = new TextDecoder('utf-16le', { fatal: true })
      .decode(bytes(read, true))
      .replace(/\0$/, '');
    if (!value || value.includes('\0')) throw new FontEffectsError('unreadable document tags');
    return value;
  };
  if (count < 0 || count > 64) throw new FontEffectsError('too many nested document tags');
  for (let i = 0; i < count; i++) {
    const mark = p.FPDFPageObj_GetMark(object, i);
    const name = string((buffer, length) => p.FPDFPageObjMark_GetName(mark, buffer, length, ptr));
    const params: Param[] = [];
    const total = p.FPDFPageObjMark_CountParams(mark);
    if (total < 0 || total > 64) throw new FontEffectsError('complex document tags');
    // Optional-content tags control visibility through referenced dictionaries.
    if (name === 'OC') throw new FontEffectsError('optional PDF layers');
    for (let j = 0; j < total; j++) {
      const key = string((buffer, length) =>
        p.FPDFPageObjMark_GetParamKey(mark, j, buffer, length, ptr),
      );
      // Reusing replacement/alternative text after editing would leave stale
      // accessibility content. Do not silently copy it or delete it.
      if (['ActualText', 'Alt', 'E'].includes(key))
        throw new FontEffectsError('accessibility replacement text');
      const type = p.FPDFPageObjMark_GetParamValueType(mark, key);
      if (type === 2) {
        if (!p.FPDFPageObjMark_GetParamFloatValue(mark, key, ptr))
          throw new FontEffectsError('unreadable document tags');
        const value = p.pdfium.getValue(ptr, 'float');
        if (!Number.isFinite(value)) throw new FontEffectsError('invalid document tags');
        // Preserve integer IDs without rounding them through float32.
        if (!p.FPDFPageObjMark_GetParamIntValue(mark, key, ptr))
          throw new FontEffectsError('unreadable document tags');
        const integer = p.pdfium.getValue(ptr, 'i32');
        params.push({ key, value: Math.fround(integer) === value ? integer : value });
      } else if (type === 3) {
        params.push({
          key,
          value: bytes((buffer, length) =>
            p.FPDFPageObjMark_GetParamBlobValue(mark, key, buffer, length, ptr),
          ),
        });
      } else throw new FontEffectsError('complex document tag properties');
    }
    marks.push({ name, params });
  }
  return marks;
}

export function readFontEffects(p: WrappedPdfiumModule, page: number, object: number, ptr: number) {
  const clip = p.FPDFPageObj_GetClipPath(object);
  if (clip && p.FPDFClipPath_CountPaths(clip) > 0 && !redundantPageClip(p, page, clip, ptr))
    throw new FontEffectsError('a clipping mask');
  const mode = p.FPDFTextObj_GetTextRenderMode(object);
  if (mode < 0 || mode > 3) throw new FontEffectsError('text that forms a clipping mask');
  const colors = [p.FPDFPageObj_GetFillColor, p.FPDFPageObj_GetStrokeColor].map((get) => {
    if (!get(object, ptr, ptr + 4, ptr + 8, ptr + 12))
      throw new FontEffectsError('unreadable text colors');
    return [0, 4, 8, 12].map((offset) => p.pdfium.getValue(ptr + offset, 'i32')) as Color;
  });
  // HasTransparency conflates opacity with blend modes and soft masks. Probe
  // with opaque colors, then restore immediately; retained blending/masks still
  // report transparency. Only ordinary alpha can be copied with this API.
  let advanced = false;
  try {
    if (
      !p.FPDFPageObj_SetFillColor(
        object,
        ...(colors[0].slice(0, 3) as [number, number, number]),
        255,
      ) ||
      !p.FPDFPageObj_SetStrokeColor(
        object,
        ...(colors[1].slice(0, 3) as [number, number, number]),
        255,
      )
    )
      throw new FontEffectsError('unreadable transparency');
    advanced = p.FPDFPageObj_HasTransparency(object);
  } finally {
    const fill = p.FPDFPageObj_SetFillColor(object, ...colors[0]);
    const stroke = p.FPDFPageObj_SetStrokeColor(object, ...colors[1]);
    if (!fill || !stroke) throw new Error('The original text colors could not be restored.');
  }
  if (advanced) throw new FontEffectsError('a blend mode or soft mask');
  return { mode, colors, marks: readMarks(p, object, ptr) };
}

export function copyFontMarks(
  p: WrappedPdfiumModule,
  doc: number,
  object: number,
  marks: ContentMark[],
) {
  for (const { name, params } of marks) {
    const mark = p.FPDFPageObj_AddMark(object, name);
    if (!mark) throw new Error('The original document tags could not be preserved.');
    for (const { key, value } of params) {
      let copied = false;
      if (typeof value === 'number') {
        copied =
          Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
            ? p.FPDFPageObjMark_SetIntParam(doc, object, mark, key, value)
            : p.FPDFPageObjMark_SetFloatParam(doc, object, mark, key, value);
      } else {
        const buffer = p.pdfium.wasmExports.malloc(Math.max(1, value.length));
        if (!buffer) throw new Error('Not enough browser memory to preserve document tags.');
        try {
          heap(p).set(value, buffer);
          copied = p.FPDFPageObjMark_SetBlobParam(doc, object, mark, key, buffer, value.length);
        } finally {
          p.pdfium.wasmExports.free(buffer);
        }
      }
      if (!copied) throw new Error('The original document tags could not be preserved.');
    }
  }
}
