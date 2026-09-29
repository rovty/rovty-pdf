import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { FontMatchError, type RecoveredFont } from '../lib/fontRecovery';
import { copyFontMarks, readFontEffects } from './fontEffects';

function heap(p: WrappedPdfiumModule) {
  return (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}

export function importRecoveryFont(p: WrappedPdfiumModule, doc: number, source: RecoveredFont) {
  const pointer = p.pdfium.wasmExports.malloc(source.pdf.length);
  if (!pointer) throw new Error('Not enough browser memory to recover this font.');
  heap(p).set(source.pdf, pointer);
  const donor = p.FPDF_LoadMemDocument(pointer, source.pdf.length, '');
  const index = p.FPDF_GetPageCount(doc);
  let page = 0,
    imported = false;
  const dispose = () => {
    if (page) p.FPDF_ClosePage(page);
    if (imported) p.FPDFPage_Delete(doc, index);
  };
  try {
    if (!donor || !p.FPDF_ImportPages(doc, donor, '1', index))
      throw new Error('The matching font could not be opened.');
    imported = true;
    page = p.FPDF_LoadPage(doc, index);
    const object = p.FPDFPage_GetObject(page, 0);
    const font = p.FPDFTextObj_GetFont(object);
    if (!page || !font) throw new Error('The matching font could not be opened.');
    // Keep the donor page alive while the borrowed font handle is in use.
    // New text objects retain the font after the temporary page is deleted.
    return { font, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    if (donor) p.FPDF_CloseDocument(donor);
    p.pdfium.wasmExports.free(pointer);
  }
}

function matchesGlyphs(
  p: WrappedPdfiumModule,
  original: number,
  candidate: number,
  text: string,
  ptr: number,
) {
  let compared = 0;
  for (const char of new Set(text)) {
    if (/\s/u.test(char)) continue;
    const code = char.codePointAt(0)!;
    if (
      !p.FPDFFont_GetGlyphWidth(original, code, 1000, ptr) ||
      !p.FPDFFont_GetGlyphWidth(candidate, code, 1000, ptr + 4) ||
      Math.abs(p.pdfium.getValue(ptr, 'float') - p.pdfium.getValue(ptr + 4, 'float')) > 1
    )
      return false;
    const a = p.FPDFFont_GetGlyphPath(original, code, 1000);
    const b = p.FPDFFont_GetGlyphPath(candidate, code, 1000);
    const count = p.FPDFGlyphPath_CountGlyphSegments(a);
    if (!a || !b || count <= 0 || count !== p.FPDFGlyphPath_CountGlyphSegments(b)) return false;
    for (let i = 0; i < count; i++) {
      const left = p.FPDFGlyphPath_GetGlyphPathSegment(a, i);
      const right = p.FPDFGlyphPath_GetGlyphPathSegment(b, i);
      if (
        p.FPDFPathSegment_GetType(left) !== p.FPDFPathSegment_GetType(right) ||
        p.FPDFPathSegment_GetClose(left) !== p.FPDFPathSegment_GetClose(right) ||
        !p.FPDFPathSegment_GetPoint(left, ptr, ptr + 4) ||
        !p.FPDFPathSegment_GetPoint(right, ptr + 8, ptr + 12)
      )
        return false;
      for (const offset of [0, 4])
        if (
          Math.abs(
            p.pdfium.getValue(ptr + offset, 'float') - p.pdfium.getValue(ptr + offset + 8, 'float'),
          ) > 0.00075
        )
          return false;
    }
    compared++;
  }
  return compared > 0;
}

export function recoverTextObject(
  p: WrappedPdfiumModule,
  doc: number,
  page: number,
  object: number,
  font: number,
  originalText: string,
  name: string,
  allowTypefaceChange = false,
) {
  const ptr = p.pdfium.wasmExports.malloc(32);
  if (!ptr) throw new Error('Not enough browser memory to recover this font.');
  let replacement = 0;
  try {
    if (
      !allowTypefaceChange &&
      !matchesGlyphs(p, p.FPDFTextObj_GetFont(object), font, originalText, ptr)
    )
      throw new FontMatchError(name);
    const { mode, colors, marks } = readFontEffects(p, page, object, ptr);
    if (!p.FPDFTextObj_GetFontSize(object, ptr))
      throw new Error('The text size could not be read.');
    replacement = p.FPDFPageObj_CreateTextObj(doc, font, p.pdfium.getValue(ptr, 'float'));
    if (
      !replacement ||
      !p.FPDFPageObj_GetMatrix(object, ptr) ||
      !p.FPDFPageObj_SetMatrix(replacement, ptr) ||
      !p.FPDFTextObj_SetTextRenderMode(replacement, mode)
    )
      throw new Error('The original text position could not be preserved.');
    copyFontMarks(p, doc, replacement, marks);
    for (const stroke of [false, true]) {
      const set = stroke ? p.FPDFPageObj_SetStrokeColor : p.FPDFPageObj_SetFillColor;
      if (!set(replacement, ...colors[stroke ? 1 : 0]))
        throw new Error('The original text color could not be preserved.');
    }
    if (mode !== 0) {
      const count = p.FPDFPageObj_GetDashCount(object);
      if (count !== 0 || !p.FPDFPageObj_GetStrokeWidth(object, ptr))
        throw new Error('The original text outline could not be preserved.');
      if (
        !p.FPDFPageObj_SetStrokeWidth(replacement, p.pdfium.getValue(ptr, 'float')) ||
        !p.FPDFPageObj_SetLineCap(replacement, p.FPDFPageObj_GetLineCap(object)) ||
        !p.FPDFPageObj_SetLineJoin(replacement, p.FPDFPageObj_GetLineJoin(object))
      )
        throw new Error('The original text outline could not be preserved.');
    }
    let index = 0;
    while (index < p.FPDFPage_CountObjects(page) && p.FPDFPage_GetObject(page, index) !== object)
      index++;
    if (
      index === p.FPDFPage_CountObjects(page) ||
      !p.FPDFPage_InsertObjectAtIndex(page, replacement, index)
    )
      throw new Error('The text could not be replaced in its original position.');
    const inserted = replacement;
    replacement = 0; // The page now owns it, including on subsequent failures.
    if (!p.FPDFPage_RemoveObject(page, object))
      throw new Error('The original text could not be replaced.');
    p.FPDFPageObj_Destroy(object);
    return inserted;
  } finally {
    if (replacement) p.FPDFPageObj_Destroy(replacement);
    p.pdfium.wasmExports.free(ptr);
  }
}
