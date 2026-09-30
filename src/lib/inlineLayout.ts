import type { Mark, NativeText, PageInfo } from './types';
import { groupTextLines, textSources } from './textBlocks';
import { transformPoint } from './utils';
import { visibleTextSize } from './textMetrics';

/** Interaction bounds are independent of the larger export/layout box. */
export function textSelectionBounds(mark: Mark, info: PageInfo): InlineLayout['bounds'] {
  if (!mark.originalText)
    return {
      x: mark.x,
      y: mark.y,
      width: mark.width,
      height: Math.max(1, (mark.text || '').split('\n').length) * mark.fontSize * 1.2,
    };
  const original = mark.originalText;
  const a = transformPoint(info.transform, original.bounds[0], original.bounds[1]);
  const b = transformPoint(info.transform, original.bounds[2], original.bounds[3]);
  const ratio = mark.fontSize / visibleTextSize(original);
  return {
    x: mark.x,
    y: mark.y,
    width: mark.text === original.text ? Math.max(8, Math.abs(b[0] - a[0]) * ratio) : mark.width,
    height: Math.max(mark.fontSize * 0.65, Math.abs(b[1] - a[1]) * ratio),
  };
}

export interface CaretStop {
  index: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  ascent: number;
  descent: number;
}
export interface InlineLayout {
  stops: CaretStop[];
  boxes: { start: number; end: number; x: number; y: number; width: number; height: number }[];
  bounds: { x: number; y: number; width: number; height: number };
  exact: boolean;
}

/** Cursor geometry comes from the PDF's glyph positions, not a substitute browser font. */
export function inlineLayout(items: NativeText[], mark: Mark, info: PageInfo): InlineLayout {
  const text = mark.text || '',
    stops: CaretStop[] = [],
    boxes: InlineLayout['boxes'] = [];
  const candidates = [...groupTextLines(items), ...items];
  let offset = 0,
    exact = true;
  for (const [lineIndex, line] of text.split('\n').entries()) {
    const visibleLine = line.replace(/^ +| +$/g, '');
    const leadingSpaces = line.length - line.replace(/^ +/, '').length;
    const fallbackY = mark.y + mark.fontSize * (0.9 + lineIndex * 1.2);
    const fallback = (index: number): CaretStop => ({
      index: offset + index,
      x: mark.x + index * mark.fontSize * 0.55,
      y: fallbackY,
      nx: 0,
      ny: 1,
      ascent: mark.fontSize * 0.9,
      descent: mark.fontSize * 0.25,
    });
    let best: NativeText | undefined,
      distance = Infinity;
    if (line.trim())
      for (const item of candidates) {
        if (!item.text.includes(visibleLine)) continue;
        const a = transformPoint(info.transform, item.bounds[0], item.bounds[1]),
          b = transformPoint(info.transform, item.bounds[2], item.bounds[3]);
        const d = Math.hypot(
          Math.min(a[0], b[0]) - mark.x,
          Math.min(a[1], b[1]) - (mark.y + lineIndex * mark.fontSize * 1.2),
        );
        if (d < distance) {
          best = item;
          distance = d;
        }
      }
    if (!best || distance > mark.fontSize * 4) {
      exact = false;
      for (let index = 0; index <= line.length; index++) stops[offset + index] = fallback(index);
      offset += line.length + 1;
      continue;
    }
    const substring = best.text.indexOf(visibleLine) - leadingSpaces;
    let runOffset = 0;
    for (const run of textSources(best)) {
      const found = best.text.indexOf(run.text, runOffset);
      if (found >= 0) runOffset = found;
      for (const glyph of run.glyphs || []) {
        const index = runOffset + glyph.index - substring;
        if (index < 0 || index >= line.length) continue;
        const origin = transformPoint(info.transform, ...glyph.origin),
          end = transformPoint(info.transform, ...glyph.end);
        const length = Math.hypot(end[0] - origin[0], end[1] - origin[1]);
        const nx = length ? -(end[1] - origin[1]) / length : 0,
          ny = length ? (end[0] - origin[0]) / length : 1;
        const corners = [
          [glyph.bounds[0], glyph.bounds[1]],
          [glyph.bounds[2], glyph.bounds[1]],
          [glyph.bounds[2], glyph.bounds[3]],
          [glyph.bounds[0], glyph.bounds[3]],
        ].map(([x, y]) => transformPoint(info.transform, x, y));
        const projections = corners.map(([x, y]) => (x - origin[0]) * nx + (y - origin[1]) * ny);
        const common = {
          nx,
          ny,
          ascent: Math.max(mark.fontSize * 0.65, -Math.min(...projections)),
          descent: Math.max(mark.fontSize * 0.18, Math.max(...projections)),
        };
        stops[offset + index] = { index: offset + index, x: origin[0], y: origin[1], ...common };
        stops[offset + index + glyph.text.length] = {
          index: offset + index + glyph.text.length,
          x: end[0],
          y: end[1],
          ...common,
        };
        const x = Math.min(...corners.map((p) => p[0])),
          y = Math.min(...corners.map((p) => p[1]));
        boxes.push({
          start: offset + index,
          end: offset + index + glyph.text.length,
          x,
          y,
          width: Math.max(1, Math.max(...corners.map((p) => p[0])) - x),
          height: Math.max(mark.fontSize * 0.7, Math.max(...corners.map((p) => p[1])) - y),
        });
      }
      runOffset += run.text.length;
    }
    // PDF extraction can omit edge spaces. Keep the caret moving by this
    // font's measured space advance instead of switching the whole line to
    // approximate browser metrics whenever the user presses Space.
    const spaceWidth = best.spaceWidth ?? textSources(best)[0]?.spaceWidth;
    for (let index = 0; index <= line.length; index++) {
      if (stops[offset + index]) continue;
      const previous = stops[offset + index - 1];
      const next = stops[offset + leadingSpaces];
      const anchor = index < leadingSpaces ? next : previous;
      if (
        anchor &&
        spaceWidth !== undefined &&
        (index < leadingSpaces || line[index - 1] === ' ')
      ) {
        const advance = index < leadingSpaces ? (index - leadingSpaces) * spaceWidth : spaceWidth;
        stops[offset + index] = {
          ...anchor,
          index: offset + index,
          x: anchor.x + anchor.ny * advance,
          y: anchor.y - anchor.nx * advance,
        };
      } else {
        stops[offset + index] = previous ? { ...previous, index: offset + index } : fallback(index);
      }
    }
    offset += line.length + 1;
  }
  const fallbackBounds = textSelectionBounds(mark, info);
  const measured = exact && boxes.length > 0;
  const x = measured
      ? Math.min(...boxes.map((b) => b.x), ...stops.filter(Boolean).map((s) => s.x))
      : fallbackBounds.x,
    y = measured ? Math.min(...boxes.map((b) => b.y)) : fallbackBounds.y;
  const right = Math.max(
      measured ? x : fallbackBounds.x + fallbackBounds.width,
      ...boxes.map((b) => b.x + b.width),
      ...stops.filter(Boolean).map((s) => s.x),
    ),
    bottom = Math.max(
      measured ? y : fallbackBounds.y + fallbackBounds.height,
      ...boxes.map((b) => b.y + b.height),
    );
  return {
    stops: stops.filter(Boolean),
    boxes,
    bounds: {
      x,
      y,
      width: Math.max(8, right - x),
      height: Math.max(mark.fontSize * 0.65, bottom - y),
    },
    exact: exact && boxes.length > 0,
  };
}
