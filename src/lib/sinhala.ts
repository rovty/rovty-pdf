import {
  PDFDocument,
  PDFPage,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  pushGraphicsState,
  popGraphicsState,
  setGraphicsState,
  beginText,
  endText,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  endMarkedContent,
  type Color,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type * as HarfBuzz from 'harfbuzzjs';
import type { Mark } from './types';
import type { InlineLayout } from './inlineLayout';

const fonts = new Map<boolean, Promise<SinhalaFont>>();
export const sinhalaFontPath = (bold = false) =>
  `/fonts/sinhala/NotoSerifSinhala-${bold ? 'Bold' : 'Regular'}.ttf`;
export interface SinhalaFont {
  bytes: Uint8Array;
  shape: (text: string) => {
    glyphs: {
      id: number;
      cluster: number;
      x: number;
      y: number;
      start: number;
      end: number;
      bounds: [number, number, number, number];
    }[];
    width: number;
  };
}

// Exported separately so native tests can exercise shaping with local assets.
export async function createSinhalaFont(bytes: Uint8Array): Promise<SinhalaFont> {
  const hb = await import('harfbuzzjs');
  const face = new hb.Face(new hb.Blob(bytes));
  const font = new hb.Font(face);
  const buffer = new hb.Buffer();
  const upem = face.upem;
  if (!upem) throw new Error('The Sinhala font could not be opened.');
  return {
    bytes,
    shape(text) {
      if (text.length > 100000)
        throw new Error('Keep an edited text line under 100,000 characters.');
      buffer.reset();
      buffer.addText(text);
      buffer.setDirection(hb.Direction.LTR);
      buffer.setScript('Sinh');
      buffer.setLanguage('si');
      hb.shape(font, buffer);
      const info = buffer.getGlyphInfos(),
        positions = buffer.getGlyphPositions();
      let x = 0,
        y = 0;
      const glyphs = info.map((glyph: HarfBuzz.GlyphInfo, i: number) => {
        if (!glyph.codepoint)
          throw new Error(
            'Noto Serif Sinhala cannot display a character in this line. Use Sinhala or English text.',
          );
        const position = positions[i];
        const extents = font.glyphExtents(glyph.codepoint);
        const left = x + position.xOffset + (extents?.xBearing || 0);
        const top = y + position.yOffset + (extents?.yBearing || 0);
        const result = {
          id: glyph.codepoint,
          cluster: glyph.cluster,
          x: (x + position.xOffset) / upem,
          y: (y + position.yOffset) / upem,
          start: x / upem,
          end: (x + position.xAdvance) / upem,
          bounds: [
            left / upem,
            top / upem,
            (left + (extents?.width || 0)) / upem,
            (top + (extents?.height || 0)) / upem,
          ] as [number, number, number, number],
        };
        x += position.xAdvance;
        y += position.yAdvance;
        return result;
      });
      return { glyphs, width: x / upem };
    },
  };
}

// Use the same shaped clusters for the caret and selection as for PDF output.
// PDF extractors may split/reorder the glyphs even when ActualText is present.
export function sinhalaInlineLayout(data: SinhalaFont, mark: Mark): InlineLayout {
  const stops: InlineLayout['stops'] = [],
    boxes: InlineLayout['boxes'] = [];
  let offset = 0,
    width = mark.width;
  const size = mark.fontSize;
  for (const [lineIndex, line] of (mark.text || '').split('\n').entries()) {
    const run = data.shape(line),
      baseline = mark.y + size * (0.9 + lineIndex * 1.2);
    width = Math.max(width, run.width * size);
    const groups = new Map<number, typeof run.glyphs>();
    for (const glyph of run.glyphs) {
      const group = groups.get(glyph.cluster);
      if (group) group.push(glyph);
      else groups.set(glyph.cluster, [glyph]);
    }
    const clusters = [...groups.keys()].sort((a, b) => a - b);
    for (const [i, start] of clusters.entries()) {
      const end = clusters[i + 1] ?? line.length;
      const glyphs = groups.get(start)!;
      const left = Math.min(...glyphs.map((g) => g.start));
      const right = Math.max(...glyphs.map((g) => g.end));
      const x = mark.x + size * Math.min(left, ...glyphs.map((g) => g.bounds[0]));
      const top = baseline - size * Math.max(0.9, ...glyphs.map((g) => g.bounds[1]));
      const bottom = baseline - size * Math.min(-0.25, ...glyphs.map((g) => g.bounds[3]));
      boxes.push({
        start: offset + start,
        end: offset + end,
        x,
        y: top,
        width: Math.max(1, mark.x + size * Math.max(right, ...glyphs.map((g) => g.bounds[2])) - x),
        height: bottom - top,
      });
      const common = {
        y: baseline,
        nx: 0,
        ny: 1,
        ascent: baseline - top,
        descent: bottom - baseline,
      };
      for (let j = start; j < end; j++)
        stops.push({ ...common, index: offset + j, x: mark.x + size * left });
      if (i === clusters.length - 1)
        stops.push({ ...common, index: offset + end, x: mark.x + size * right });
    }
    if (!clusters.length)
      stops.push({
        index: offset,
        x: mark.x,
        y: baseline,
        nx: 0,
        ny: 1,
        ascent: size * 0.9,
        descent: size * 0.25,
      });
    offset += line.length + 1;
  }
  const x = Math.min(mark.x, ...boxes.map((b) => b.x)),
    y = Math.min(mark.y, ...boxes.map((b) => b.y));
  return {
    stops,
    boxes,
    exact: true,
    bounds: {
      x,
      y,
      width: Math.max(mark.x + width, ...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(mark.y + mark.height, ...boxes.map((b) => b.y + b.height)) - y,
    },
  };
}

export function loadSinhalaFont(bold = false) {
  if (!fonts.has(bold))
    fonts.set(
      bold,
      (async () => {
        const response = await fetch(sinhalaFontPath(bold), {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok)
          throw new Error('The Sinhala font could not load. Check your connection and try again.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        // Reuse the credential-free download for IME composition and errors.
        // A CSS URL would make a second font request with account cookies.
        if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
          const face = new FontFace('Noto Sinhala', bytes, { weight: bold ? '700' : '400' });
          document.fonts.add(await face.load());
        }
        return createSinhalaFont(bytes);
      })().catch((error) => {
        fonts.delete(bold);
        throw error;
      }),
    );
  return fonts.get(bold)!;
}

export async function embedSinhalaFont(doc: PDFDocument, data: SinhalaFont): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  // Full static TTF preserves glyph IDs generated by the shaping engine.
  // No fontkit layout/encoding calls: those lose mark positioning.
  return doc.embedFont(data.bytes, { subset: false });
}

export function drawSinhalaLine(
  page: PDFPage,
  font: PDFFont,
  data: SinhalaFont,
  text: string,
  options: { x: number; y: number; size: number; rotation: number; color: Color; opacity: number },
) {
  const run = data.shape(text);
  if (!text) return 0;
  const key = page.node.newFontDictionary(font.name, font.ref);
  const state = page.node.newExtGState(
    'SinhalaText',
    page.doc.context.obj({ Type: 'ExtGState', ca: options.opacity, CA: options.opacity }),
  );
  const radians = (options.rotation * Math.PI) / 180;
  const c = Math.cos(radians),
    s = Math.sin(radians);
  // Sinhala vowel reordering changes glyph order. ActualText retains the
  // user's logical Unicode text for copy, search and accessible extraction.
  const operators = [
    pushGraphicsState(),
    setGraphicsState(state),
    PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of('Span'),
      page.doc.context.obj({ ActualText: PDFHexString.fromText(text) }).toString(),
    ]),
    beginText(),
    setFillingColor(options.color),
    setFontAndSize(key, options.size),
  ];
  for (const glyph of run.glyphs) {
    const x = glyph.x * options.size,
      y = glyph.y * options.size;
    operators.push(
      setTextMatrix(c, s, -s, c, options.x + c * x - s * y, options.y + s * x + c * y),
      showText(PDFHexString.of(glyph.id.toString(16).padStart(4, '0'))),
    );
  }
  operators.push(endText(), endMarkedContent(), popGraphicsState());
  page.pushOperators(...operators);
  return run.width * options.size;
}
