import type { NativeText } from './types';
import { cleanFontName, fontKey } from '../../shared/fonts';
import { hasSinhala } from './fontLabels';
import { visibleTextSize, sameTextTransform, hasHorizontalBaseline } from './textMetrics';

interface TextLine {
  runs: NativeText[];
  text: string;
  bounds: NativeText['bounds'];
  right: number;
}

export const textSources = (item: NativeText): NativeText[] =>
  item.runs ? item.runs.flatMap(textSources) : [item];

function union(items: { bounds: NativeText['bounds'] }[]): NativeText['bounds'] {
  return items.reduce<NativeText['bounds']>(
    (box, item) => [
      Math.min(box[0], item.bounds[0]),
      Math.min(box[1], item.bounds[1]),
      Math.max(box[2], item.bounds[2]),
      Math.max(box[3], item.bounds[3]),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

const baseline = (item: NativeText) => item.matrix?.[5] ?? item.bounds[1];
const start = (item: NativeText) => item.matrix?.[4] ?? item.bounds[0];
const end = (item: NativeText) =>
  hasSinhala(item.text) || item.advance === undefined ? item.bounds[2] : start(item) + item.advance;
const space = (item: NativeText) => item.spaceWidth || visibleTextSize(item) * 0.25;
const sinhalaMark = (item: NativeText) =>
  hasSinhala(item.text) && /^[\p{M}\u200c\u200d]+$/u.test(item.text);
const prebase = (item: NativeText) => /^[\u0dd9-\u0dde]+$/.test(item.text);

function horizontal(item: NativeText) {
  const m = item.matrix;
  // Slanted glyphs can still share a horizontal baseline. Nested, rotated and
  // vertical text keeps separate selection; sameStyle also checks the shear so
  // regular and italic spans are never flattened into the same font style.
  return item.path.length === 1 && !/[\r\n]/.test(item.text) && (!m || hasHorizontalBaseline(item));
}

function sameStyle(a: NativeText, b: NativeText) {
  const family = fontKey(cleanFontName(a.fontName));
  return (
    ((a.fontResource === b.fontResource && a.fontName === b.fontName) ||
      ((hasSinhala(a.text) || hasSinhala(b.text)) &&
        a.fontName !== 'Original PDF font' &&
        !!family &&
        family === fontKey(cleanFontName(b.fontName)))) &&
    a.fontEmbedded === b.fontEmbedded &&
    a.color === b.color &&
    Math.abs(a.opacity - b.opacity) < 0.01 &&
    sameTextTransform(a, b)
  );
}

function lowerBound(values: number[], value: number) {
  let low = 0,
    high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function append(line: TextLine, run: NativeText) {
  const previous = line.runs[line.runs.length - 1];
  const gap = start(run) - line.right;
  const sinhala = hasSinhala(previous.text) || hasSinhala(run.text);
  const separator =
    gap > Math.max(space(previous) * 0.45, sinhala ? visibleTextSize(run) * 0.16 : 0) &&
    (!sinhalaMark(run) || prebase(run)) &&
    !prebase(previous) &&
    !/[\u0dca\u200c\u200d]$/.test(line.text) &&
    !/\s$/.test(line.text) &&
    !/^\s/.test(run.text)
      ? ' '
      : '';
  // A separately positioned pre-base vowel is drawn before its consonant,
  // but Unicode stores it after the consonant (or joined consonant cluster).
  const base =
    prebase(previous) && /^([\u0d9a-\u0dc6](?:\u0dca\u200d?[\u0d9a-\u0dc6])*)(.*)$/u.exec(run.text);
  if (base)
    line.text = line.text.slice(0, -previous.text.length) + base[1] + previous.text + base[2];
  else line.text += separator + run.text;
  line.runs.push(run);
  line.bounds = union([line, run]);
  line.right = Math.max(line.right, end(run));
}

/** Combine matching text by geometry, never by content-stream order. */
export function groupTextLines(items: NativeText[]): NativeText[] {
  const separate = items.filter((item) => !horizontal(item));
  const sorted = items
    .filter((item) => horizontal(item) && !sinhalaMark(item))
    .sort((a, b) => baseline(b) - baseline(a) || start(a) - start(b));
  const rows: NativeText[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (
      row &&
      Math.abs(baseline(row[0]) - baseline(item)) <=
        Math.min(visibleTextSize(row[0]), visibleTextSize(item)) * 0.15
    )
      row.push(item);
    else rows.push([item]);
  }
  // Raised/lowered vowel signs can have their own text matrices. Attach them
  // to the nearest compatible row locally, rather than creating a new line.
  // Index base rows by height and horizontal extent so each mark only checks
  // nearby glyphs, even on pages containing thousands of separate characters.
  const rowIndex = rows
    .map((row) => {
      const items = [...row].sort((a, b) => a.bounds[0] - b.bounds[0]);
      let right = -Infinity;
      return {
        row,
        items,
        y: baseline(row[0]),
        rights: items.map((item) => (right = Math.max(right, item.bounds[2]))),
      };
    })
    .sort((a, b) => a.y - b.y);
  const heights = rowIndex.map((row) => row.y);
  for (const mark of items.filter((item) => horizontal(item) && sinhalaMark(item))) {
    let best: NativeText[] | undefined,
      distance = Infinity;
    const y = baseline(mark),
      size = visibleTextSize(mark),
      reach = size * 0.55;
    for (
      let i = lowerBound(heights, y - size * 0.6);
      i < rowIndex.length && heights[i] <= y + size * 0.6;
      i++
    ) {
      const candidate = rowIndex[i];
      const dy = Math.abs(candidate.y - y);
      for (
        let j = lowerBound(candidate.rights, mark.bounds[0] - reach);
        j < candidate.items.length;
        j++
      ) {
        const item = candidate.items[j];
        if (item.bounds[0] > mark.bounds[2] + reach) break;
        const dx = Math.max(0, mark.bounds[0] - item.bounds[2], item.bounds[0] - mark.bounds[2]);
        if (dx <= reach && sameStyle(item, mark) && dx + dy < distance) {
          best = candidate.row;
          distance = dx + dy;
        }
      }
    }
    if (best) best.push(mark);
    else rows.push([mark]);
  }
  const lines: TextLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => start(a) - start(b));
    let line: TextLine | undefined;
    for (const item of row) {
      const previous = line?.runs[line.runs.length - 1];
      const gap = line ? start(item) - line.right : Infinity;
      const size = visibleTextSize(item);
      if (
        line &&
        previous &&
        sameStyle(previous, item) &&
        gap >= -size * (sinhalaMark(item) || sinhalaMark(previous) ? 1.5 : 0.2) &&
        gap <= Math.max(space(item) * 2.5, size * (hasSinhala(item.text) ? 0.9 : 0.55))
      ) {
        append(line, item);
      } else {
        line = { runs: [item], text: item.text, bounds: [...item.bounds], right: end(item) };
        lines.push(line);
      }
    }
  }
  return [
    ...separate,
    ...lines.map((line): NativeText => {
      const first = line.runs[0];
      // Text extraction can append a generated space before a distant column.
      // Keep original runs for no-op exports, but omit that edge space in the UI.
      const text = hasSinhala(line.text)
        ? line.text.trimEnd().normalize('NFC')
        : line.text.trimEnd();
      if (line.runs.length === 1 && text === first.text) return first;
      return { ...first, text, bounds: line.bounds, runs: line.runs.flatMap(textSources) };
    }),
  ].sort((a, b) => b.bounds[3] - a.bounds[3] || a.bounds[0] - b.bounds[0]);
}
