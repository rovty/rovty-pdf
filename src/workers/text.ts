import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type { NativeText, NativeTextEdit } from '../lib/types';
import { FontRecoveryError, recoveryFontName, type RecoveredFont } from '../lib/fontRecovery';
import { importRecoveryFont, recoverTextObject } from './recoveredFont';
import { hasSinhala } from '../lib/fontLabels';
import { visibleTextSize, sameTextTransform } from '../lib/textMetrics';

function allocate(p: WrappedPdfiumModule, size: number) {
  const ptr = p.pdfium.wasmExports.malloc(Math.max(size, 1));
  if (!ptr) throw new Error('Not enough browser memory for this PDF.');
  return ptr;
}
function heap(p: WrappedPdfiumModule) {
  return (p.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
}
function findObject(p: WrappedPdfiumModule, page: number, path: number[]) {
  const ancestors: number[] = [];
  let parent = page,
    object = 0;
  for (let i = 0; i < path.length; i++) {
    object =
      i === 0 ? p.FPDFPage_GetObject(parent, path[i]) : p.FPDFFormObj_GetObject(parent, path[i]);
    if (!object)
      throw new Error('An editable text object could not be found. Reopen the original document.');
    if (i < path.length - 1) {
      ancestors.push(object);
      parent = object;
    }
  }
  return { object, parent, ancestors, nested: path.length > 1 };
}
function fontName(p: WrappedPdfiumModule, object: number) {
  const font = p.FPDFTextObj_GetFont(object);
  const size = p.FPDFFont_GetBaseFontName(font, 0, 0);
  if (!size || size > 4096) return 'Original PDF font';
  const ptr = allocate(p, size);
  try {
    p.FPDFFont_GetBaseFontName(font, ptr, size);
    return new TextDecoder()
      .decode(heap(p).subarray(ptr, ptr + size - 1))
      .replace(/^[A-Z]{6}\+/, '');
  } finally {
    p.pdfium.wasmExports.free(ptr);
  }
}
function textCharacter(
  p: WrappedPdfiumModule,
  textPage: number,
  index: number,
  count: number,
  buffer: number,
) {
  const object = p.FPDFText_GetTextObject(textPage, index);
  const code = p.FPDFText_GetUnicode(textPage, index);
  const generated = p.FPDFText_IsGenerated(textPage, index) === 1;
  if (!object || code <= 0 || code > 0x10ffff) return;
  const previous = index > 0 ? p.FPDFText_GetTextObject(textPage, index - 1) : 0;
  // Some character maps label a visible space glyph as CR/LF. A PDF text
  // object's glyphs share one baseline; real line changes create new objects.
  // Keep the visual word gap, not a hidden newline in the editable value.
  if (
    !generated &&
    code === 10 &&
    previous === object &&
    p.FPDFText_GetUnicode(textPage, index - 1) === 13
  )
    return;
  let nextIndex = index + 1;
  if (
    !generated &&
    code === 13 &&
    nextIndex < count &&
    p.FPDFText_GetTextObject(textPage, nextIndex) === object &&
    p.FPDFText_GetUnicode(textPage, nextIndex) === 10
  )
    nextIndex++;
  const next = nextIndex < count ? p.FPDFText_GetTextObject(textPage, nextIndex) : 0;
  // TJ arrays can encode word gaps without a space glyph. Keep gaps inside
  // the same source object, but never attach a generated column gap/newline.
  if (generated && (code !== 32 || previous !== object || next !== object)) return;
  let text = code === 10 || code === 13 ? ' ' : String.fromCodePoint(code);
  let gap: { origin: [number, number]; end: [number, number] } | undefined;
  if (text === ' ' && next === object) {
    const m = matrix(p, object, buffer);
    const font = p.FPDFTextObj_GetFont(object);
    const size = p.FPDFText_GetFontSize(textPage, index);
    const originAt = (i: number): [number, number] | undefined =>
      p.FPDFText_GetCharOrigin(textPage, i, buffer, buffer + 8)
        ? [p.pdfium.getValue(buffer, 'double'), p.pdfium.getValue(buffer + 8, 'double')]
        : undefined;
    const origin = originAt(generated ? index - 1 : index);
    const end = originAt(nextIndex);
    if (origin && end) {
      if (generated) {
        if (
          !p.FPDFFont_GetGlyphWidth(font, p.FPDFText_GetUnicode(textPage, index - 1), size, buffer)
        )
          return { object, text };
        const width = p.pdfium.getValue(buffer, 'float');
        origin[0] += width * m[0];
        origin[1] += width * m[1];
      } else if (p.FPDFFont_GetGlyphWidth(font, 32, size, buffer)) {
        // The extractor collapses consecutive literal spaces. Recover their
        // count only when the advance is a whole number of font space widths.
        const width = p.pdfium.getValue(buffer, 'float');
        const ratio =
          ((end[0] - origin[0]) * m[0] + (end[1] - origin[1]) * m[1]) /
          (width * (m[0] ** 2 + m[1] ** 2));
        const spaces = Math.round(ratio);
        if (
          Number.isFinite(ratio) &&
          spaces > 1 &&
          spaces <= 1000 &&
          Math.abs(ratio - spaces) < 0.05
        )
          text = ' '.repeat(spaces);
      }
      gap = { origin, end };
    }
  }
  return { object, text, gap };
}

function objectText(p: WrappedPdfiumModule, object: number, textPage: number) {
  let text = '';
  const count = p.FPDFText_CountChars(textPage);
  const buffer = allocate(p, 32);
  try {
    for (let i = 0; i < count; i++) {
      if (p.FPDFText_GetTextObject(textPage, i) !== object) continue;
      text += textCharacter(p, textPage, i, count, buffer)?.text || '';
      if (text.length > 100000) throw new Error('This text block is too large to edit.');
    }
    return text;
  } finally {
    p.pdfium.wasmExports.free(buffer);
  }
}
export function readText(
  p: WrappedPdfiumModule,
  page: number,
  includeGlyphs = false,
): NativeText[] {
  const textPage = p.FPDFText_LoadPage(page);
  if (!textPage) return [];
  const paths = new Map<number, number[]>();
  const walk = (parent: number, path: number[]) => {
    if (path.length > 12) return;
    const count = path.length
      ? p.FPDFFormObj_CountObjects(parent)
      : p.FPDFPage_CountObjects(parent);
    for (let i = 0; i < count; i++) {
      const obj = path.length
        ? p.FPDFFormObj_GetObject(parent, i)
        : p.FPDFPage_GetObject(parent, i);
      const next = [...path, i],
        kind = p.FPDFPageObj_GetType(obj);
      if (kind === 1) paths.set(obj, next);
      if (kind === 5) walk(obj, next);
    }
  };
  walk(page, []);
  const buffer = allocate(p, 32),
    groups = new Map<number, NativeText>();
  try {
    const count = p.FPDFText_CountChars(textPage);
    if (count > 100000)
      throw new Error(
        'This page has too much text to edit safely. Try another page or a smaller document.',
      );
    for (let i = 0; i < count; i++) {
      const character = textCharacter(p, textPage, i, count, buffer);
      if (!character) continue;
      const obj = character.object,
        path = paths.get(obj);
      if (!path) continue;
      if (!p.FPDFText_GetCharBox(textPage, i, buffer, buffer + 8, buffer + 16, buffer + 24))
        continue;
      const left = p.pdfium.getValue(buffer, 'double'),
        right = p.pdfium.getValue(buffer + 8, 'double');
      const bottom = p.pdfium.getValue(buffer + 16, 'double'),
        top = p.pdfium.getValue(buffer + 24, 'double');
      let item = groups.get(obj);
      if (!item) {
        let color = '#171719',
          opacity = 1;
        if (p.FPDFPageObj_GetFillColor(obj, buffer, buffer + 4, buffer + 8, buffer + 12)) {
          color =
            '#' +
            [0, 4, 8]
              .map((offset) =>
                p.pdfium
                  .getValue(buffer + offset, 'i32')
                  .toString(16)
                  .padStart(2, '0'),
              )
              .join('');
          opacity = p.pdfium.getValue(buffer + 12, 'i32') / 255;
        }
        item = {
          path,
          text: '',
          bounds: [left, bottom, right, top],
          size: p.FPDFText_GetFontSize(textPage, i),
          color,
          opacity,
          fontName: fontName(p, obj),
          fontEmbedded: p.FPDFFont_GetIsEmbedded(p.FPDFTextObj_GetFont(obj)) === 1,
        };
        groups.set(obj, item);
      }
      item.bounds = [
        Math.min(left, item.bounds[0]),
        Math.min(bottom, item.bounds[1]),
        Math.max(right, item.bounds[2]),
        Math.max(top, item.bounds[3]),
      ];
      {
        const char = character.text;
        if (includeGlyphs) {
          const m = matrix(p, obj, buffer);
          let origin: [number, number] = [left, bottom];
          if (p.FPDFText_GetCharOrigin(textPage, i, buffer, buffer + 8))
            origin = [p.pdfium.getValue(buffer, 'double'), p.pdfium.getValue(buffer + 8, 'double')];
          const font = p.FPDFTextObj_GetFont(obj);
          const width = p.FPDFFont_GetGlyphWidth(font, char.codePointAt(0)!, item.size, buffer)
            ? p.pdfium.getValue(buffer, 'float')
            : right - left;
          if (character.gap) {
            const { origin, end } = character.gap;
            for (let j = 0; j < char.length; j++) {
              const at = (fraction: number): [number, number] => [
                origin[0] + (end[0] - origin[0]) * fraction,
                origin[1] + (end[1] - origin[1]) * fraction,
              ];
              const a = at(j / char.length),
                b = at((j + 1) / char.length);
              const corners = [a, b].flatMap(([x, y]) =>
                [-0.2, 0.8].map((height) => [
                  x + m[2] * item.size * height,
                  y + m[3] * item.size * height,
                ]),
              );
              (item.glyphs ??= []).push({
                index: item.text.length + j,
                text: ' ',
                origin: a,
                end: b,
                bounds: [
                  Math.min(...corners.map(([x]) => x)),
                  Math.min(...corners.map(([, y]) => y)),
                  Math.max(...corners.map(([x]) => x)),
                  Math.max(...corners.map(([, y]) => y)),
                ],
              });
            }
          } else {
            (item.glyphs ??= []).push({
              index: item.text.length,
              text: char,
              bounds: [left, bottom, right, top],
              origin,
              end: [origin[0] + width * m[0], origin[1] + width * m[1]],
            });
          }
        }
        item.text += char;
        if (item.text.length > 100000) throw new Error('This text block is too large to edit.');
      }
    }
    for (const [object, item] of groups) {
      item.matrix = matrix(p, object, buffer);
      item.fontResource = p.FPDFTextObj_GetFont(object);
      let width = 0;
      let measured = true;
      for (const char of item.text) {
        if (!p.FPDFFont_GetGlyphWidth(item.fontResource, char.codePointAt(0)!, item.size, buffer)) {
          measured = false;
          break;
        }
        width += p.pdfium.getValue(buffer, 'float');
      }
      if (measured) item.advance = width * Math.hypot(item.matrix[0], item.matrix[1]);
      if (p.FPDFFont_GetGlyphWidth(item.fontResource, 32, item.size, buffer))
        item.spaceWidth =
          p.pdfium.getValue(buffer, 'float') * Math.hypot(item.matrix[0], item.matrix[1]);
    }
    return completeTextSpans(p, paths, groups, buffer).filter(
      (item) => item.text.trim() && item.bounds[2] > item.bounds[0],
    );
  } finally {
    p.pdfium.wasmExports.free(buffer);
    p.FPDFText_ClosePage(textPage);
  }
}

// ActualText can describe a word/line spread over many positioned glyph
// objects. PDFium attaches its Unicode to the first object only. Retain the
// other objects too, otherwise selection covers one glyph and replacement
// leaves most of the original word behind.
function completeTextSpans(
  p: WrappedPdfiumModule,
  paths: Map<number, number[]>,
  groups: Map<number, NativeText>,
  buffer: number,
) {
  const spans = new Map<string, number[]>();
  for (const [object, path] of paths) {
    for (let i = p.FPDFPageObj_CountMarks(object) - 1; i >= 0; i--) {
      const mark = p.FPDFPageObj_GetMark(object, i);
      if (p.FPDFPageObjMark_GetParamValueType(mark, 'ActualText') !== 3) continue;
      const key = `${path.slice(0, -1).join('.')}:${mark}`;
      const span = spans.get(key);
      if (span) span.push(object);
      else spans.set(key, [object]);
      break;
    }
  }
  for (const objects of spans.values()) {
    if (objects.length < 2) continue;
    const extracted = objects.flatMap((object) =>
      groups.has(object) ? [groups.get(object)!] : [],
    );
    const first = extracted[0];
    if (!first) continue;
    const text = extracted.map((item) => item.text).join('');
    if (/[\r\n]/.test(text)) continue;
    const runs: NativeText[] = [];
    for (const object of objects) {
      const m = matrix(p, object, buffer);
      if (!p.FPDFTextObj_GetFontSize(object, buffer)) break;
      const size = p.pdfium.getValue(buffer, 'float');
      // Do not turn a paragraph, angled span or a mixture of fonts into one line.
      if (
        Math.abs(m[5] - first.matrix![5]) > visibleTextSize(first) * 0.6 ||
        !sameTextTransform({ size, matrix: m }, first) ||
        p.FPDFTextObj_GetFont(object) !== first.fontResource ||
        !Number.isFinite(size)
      )
        break;
      if (p.FPDFPageObj_GetFillColor(object, buffer, buffer + 4, buffer + 8, buffer + 12)) {
        const color =
          '#' +
          [0, 4, 8]
            .map((offset) =>
              p.pdfium
                .getValue(buffer + offset, 'i32')
                .toString(16)
                .padStart(2, '0'),
            )
            .join('');
        if (
          color !== first.color ||
          Math.abs(p.pdfium.getValue(buffer + 12, 'i32') / 255 - first.opacity) > 0.01
        )
          break;
      }
      if (!p.FPDFPageObj_GetBounds(object, buffer, buffer + 4, buffer + 8, buffer + 12)) break;
      const bounds = [0, 4, 8, 12].map((offset) =>
        p.pdfium.getValue(buffer + offset, 'float'),
      ) as NativeText['bounds'];
      const original = groups.get(object);
      runs.push({
        ...first,
        ...original,
        path: paths.get(object)!,
        text: original?.text || '',
        size,
        matrix: m,
        bounds,
        advance: Math.max(0, bounds[2] - m[4]),
        glyphs: original?.glyphs,
        runs: undefined,
      });
    }
    if (runs.length !== objects.length) continue;
    const bounds = runs.reduce<NativeText['bounds']>(
      (b, run) => [
        Math.min(b[0], run.bounds[0]),
        Math.min(b[1], run.bounds[1]),
        Math.max(b[2], run.bounds[2]),
        Math.max(b[3], run.bounds[3]),
      ],
      [...first.bounds],
    );
    for (const object of objects) groups.delete(object);
    groups.set(objects[0], {
      ...first,
      text,
      bounds,
      runs,
      path: runs[0].path,
      matrix: runs[0].matrix,
      advance: Math.max(0, bounds[2] - runs[0].matrix![4]),
      glyphs: undefined,
    });
  }
  return [...groups.values()];
}

function matrix(p: WrappedPdfiumModule, object: number, ptr: number) {
  if (!p.FPDFPageObj_GetMatrix(object, ptr)) throw new Error('This text position cannot be read.');
  return Array.from({ length: 6 }, (_, i) => p.pdfium.getValue(ptr + i * 4, 'float'));
}
function setText(p: WrappedPdfiumModule, object: number, text: string) {
  const ptr = allocate(p, (text.length + 1) * 2);
  try {
    const view = new DataView(heap(p).buffer);
    for (let i = 0; i < text.length; i++) view.setUint16(ptr + i * 2, text.charCodeAt(i), true);
    view.setUint16(ptr + text.length * 2, 0, true);
    if (!p.FPDFText_SetText(object, ptr)) throw new Error('This PDF text cannot be changed.');
  } finally {
    p.pdfium.wasmExports.free(ptr);
  }
}
function replaceObjectText(p: WrappedPdfiumModule, page: number, object: number, text: string) {
  if (text.length > 100000) throw new Error('Keep an edited text block under 100,000 characters.');
  const before = p.FPDFText_LoadPage(page);
  if (!before) throw new Error('This text could not be read.');
  let original: string;
  try {
    original = objectText(p, object, before);
  } finally {
    p.FPDFText_ClosePage(before);
  }
  // Preserve the original positioning/kerning commands when no text was changed.
  if (text === original) return;
  if (/[\r\n]/.test(text))
    throw new Error(
      'Edit one line at a time with the original font. Use Add text or choose Noto Sans for multiple lines.',
    );
  if (/[\x00-\x1f\x7f]/.test(text))
    throw new Error('Remove control characters from this text block.');
  const font = p.FPDFTextObj_GetFont(object),
    name = fontName(p, object);
  for (const char of new Set(text)) {
    const path = p.FPDFFont_GetGlyphPath(font, char.codePointAt(0)!, 12);
    if (/\s/u.test(char)) {
      // A broken reverse character map can resolve a space to the missing-
      // glyph box. Text readback alone still calls it a space, hiding the loss.
      if (path && p.FPDFGlyphPath_CountGlyphSegments(path) > 0)
        throw new FontRecoveryError(name, original);
      continue;
    }
    if (!path || p.FPDFGlyphPath_CountGlyphSegments(path) <= 0)
      throw new FontRecoveryError(name, original);
  }
  // SetText writes Unicode scalars; it does not run the Sinhala shaper.
  // A successful readback alone cannot prove that joined letters look right.
  if (hasSinhala(text))
    throw new Error(
      'This line needs Sinhala letter shaping. Choose Noto Serif Sinhala in Text font to edit it with a different typeface, or keep the original text.',
    );
  setText(p, object, text);
  // SetText reports success even for unsupported font encodings. Read it back
  // before saving to prevent missing letters or .notdef glyphs in the download.
  const after = p.FPDFText_LoadPage(page);
  if (!after) throw new Error('The edited text could not be checked.');
  try {
    // Consecutive spaces can be collapsed by extraction even though SetText
    // retains them. Still require every word boundary and non-space character.
    if (objectText(p, object, after).replace(/ +/g, ' ') !== text.replace(/ +/g, ' '))
      throw new FontRecoveryError(name, original);
  } finally {
    p.FPDFText_ClosePage(after);
  }
}

function expandLineEdit(edit: NativeTextEdit): NativeTextEdit[] {
  const runs = edit.block?.runs;
  if (!runs?.length) return [edit];
  const unchanged = edit.text === edit.block!.text;
  const anchor = runs[0].matrix;
  return runs.map((run, index) => {
    const { block: _, ...single } = edit;
    return {
      ...single,
      path: run.path,
      text: unchanged ? run.text : index === 0 ? edit.text : '',
      remove: edit.remove || (!unchanged && index > 0),
      preserveText: unchanged && !edit.remove,
      // Preserve every original fragment and its spacing on an unchanged line.
      // Resize a selected line around its first baseline rather than letting
      // each letter grow independently and overlap its neighbour.
      delta: [
        edit.delta[0] +
          (unchanged && anchor && run.matrix ? (run.matrix[4] - anchor[4]) * (edit.scale - 1) : 0),
        edit.delta[1] +
          (unchanged && anchor && run.matrix ? (run.matrix[5] - anchor[5]) * (edit.scale - 1) : 0),
      ],
    };
  });
}

export function editText(
  p: WrappedPdfiumModule,
  doc: number,
  edits: NativeTextEdit[],
  recoveredFonts = new Map<string, RecoveredFont>(),
) {
  edits = edits.flatMap(expandLineEdit);
  const imported = new Map<string, ReturnType<typeof importRecoveryFont>>();
  try {
    for (const index of new Set(edits.map((edit) => edit.page))) {
      const page = p.FPDF_LoadPage(doc, index);
      if (!page) throw new Error('This page could not be edited.');
      const ptr = allocate(p, 32);
      try {
        // Resolve handles before removing anything: page-object indices can shift.
        const targets = edits
          .filter((edit) => edit.page === index)
          .map((edit) => ({ edit, ...findObject(p, page, edit.path) }));
        for (const target of targets) {
          const { edit, parent, ancestors, nested } = target;
          let { object } = target;
          // PDFium cannot regenerate a nested form stream after in-place edits.
          // Never return an apparently successful download with the original text.
          if (nested && !edit.remove)
            throw new Error(
              'This nested text cannot retain its original font safely in this PDF. Choose Noto Sans in Text font to replace the block, or leave it unchanged.',
            );
          // Explicit removal marks the form stream dirty. Mark the ancestors too
          // so page generation visits and saves that form without moving it.
          for (const ancestor of ancestors) {
            matrix(p, ancestor, ptr);
            if (!p.FPDFPageObj_SetMatrix(ancestor, ptr))
              throw new Error('This nested text cannot be saved safely.');
          }
          if (edit.remove || (edit.text === '' && !edit.preserveText)) {
            if (
              !(nested
                ? p.FPDFFormObj_RemoveObject(parent, object)
                : p.FPDFPage_RemoveObject(page, object))
            )
              throw new Error('This text cannot be removed safely.');
            p.FPDFPageObj_Destroy(object);
            continue;
          }
          try {
            if (!edit.preserveText) replaceObjectText(p, page, object, edit.text);
          } catch (error) {
            if (!(error instanceof FontRecoveryError)) throw error;
            const source =
              recoveredFonts.get(error.fontName) ??
              recoveredFonts.get(recoveryFontName(error.fontName));
            if (!source) throw error;
            let loaded = imported.get(error.fontName);
            if (!loaded) {
              loaded = importRecoveryFont(p, doc, source);
              imported.set(error.fontName, loaded);
            }
            object = recoverTextObject(
              p,
              doc,
              page,
              object,
              loaded.font,
              error.originalText,
              error.fontName,
            );
            replaceObjectText(p, page, object, edit.text);
          }
          const m = matrix(p, object, ptr);
          const [dx, dy] = edit.delta;
          if (!Number.isFinite(edit.scale) || edit.scale <= 0)
            throw new Error('Choose a valid text size.');
          if (dx || dy || edit.scale !== 1) {
            for (let i = 0; i < 4; i++) m[i] *= edit.scale;
            m[4] += dx;
            m[5] += dy;
            m.forEach((value, i) => p.pdfium.setValue(ptr + i * 4, value, 'float'));
            if (!p.FPDFPageObj_SetMatrix(object, ptr))
              throw new Error('The text could not be positioned.');
          }
          if (edit.color !== undefined || edit.opacity !== undefined) {
            for (const stroke of [false, true]) {
              const get = stroke ? p.FPDFPageObj_GetStrokeColor : p.FPDFPageObj_GetFillColor;
              if (!get(object, ptr, ptr + 4, ptr + 8, ptr + 12)) continue;
              const channels = [0, 4, 8, 12].map((offset) =>
                p.pdfium.getValue(ptr + offset, 'i32'),
              );
              if (edit.color)
                for (let i = 0; i < 3; i++)
                  channels[i] = parseInt(edit.color.slice(1 + i * 2, 3 + i * 2), 16);
              if (edit.opacity !== undefined) channels[3] = Math.round(edit.opacity * 255);
              const set = stroke ? p.FPDFPageObj_SetStrokeColor : p.FPDFPageObj_SetFillColor;
              set(object, channels[0], channels[1], channels[2], channels[3]);
            }
          }
        }
        if (!p.FPDFPage_GenerateContent(page))
          throw new Error('This page could not be saved after editing.');
      } finally {
        p.pdfium.wasmExports.free(ptr);
        p.FPDF_ClosePage(page);
      }
    }
  } finally {
    // Remove temporary donor pages in reverse order so original page indices
    // and the final page count never change.
    for (const loaded of [...imported.values()].reverse()) loaded.dispose();
  }
}
