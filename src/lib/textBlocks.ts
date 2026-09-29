import type { NativeText } from './types';

interface TextLine {
  runs: NativeText[];
  text: string;
  bounds: NativeText['bounds'];
}

export const textSources = (item: NativeText): NativeText[] => item.runs || [item];

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
  item.advance === undefined ? item.bounds[2] : start(item) + item.advance;
const space = (item: NativeText) => item.spaceWidth || item.size * 0.25;

function horizontal(item: NativeText) {
  const m = item.matrix;
  // Nested, angled and vertical text retains individual selection. Its original
  // coordinate system must not be guessed from an axis-aligned bounding box.
  return (
    item.path.length === 1 &&
    !/[\r\n]/.test(item.text) &&
    (!m || (m[0] > 0 && m[3] > 0 && Math.abs(m[1]) < 0.001 && Math.abs(m[2]) < 0.001))
  );
}

function sameStyle(a: NativeText, b: NativeText) {
  return (
    a.fontResource === b.fontResource &&
    a.fontName === b.fontName &&
    a.fontEmbedded === b.fontEmbedded &&
    a.color === b.color &&
    Math.abs(a.opacity - b.opacity) < 0.01 &&
    Math.abs(a.size - b.size) < 0.1 &&
    (!a.matrix ||
      !b.matrix ||
      a.matrix.slice(0, 4).every((n, i) => Math.abs(n - b.matrix![i]) < 0.001))
  );
}

function append(line: TextLine, run: NativeText) {
  const previous = line.runs[line.runs.length - 1];
  const gap = start(run) - end(previous);
  const separator =
    gap > space(previous) * 0.45 && !/\s$/.test(line.text) && !/^\s/.test(run.text) ? ' ' : '';
  line.text += separator + run.text;
  line.runs.push(run);
  line.bounds = union([line, run]);
}

/** Combine matching text by geometry, never by content-stream order. */
export function groupTextLines(items: NativeText[]): NativeText[] {
  const separate = items.filter((item) => !horizontal(item));
  const sorted = items
    .filter(horizontal)
    .sort((a, b) => baseline(b) - baseline(a) || start(a) - start(b));
  const rows: NativeText[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (
      row &&
      Math.abs(baseline(row[0]) - baseline(item)) <= Math.min(row[0].size, item.size) * 0.15
    )
      row.push(item);
    else rows.push([item]);
  }
  const lines: TextLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => start(a) - start(b));
    let line: TextLine | undefined;
    for (const item of row) {
      const previous = line?.runs[line.runs.length - 1];
      const gap = previous ? start(item) - end(previous) : Infinity;
      if (
        line &&
        previous &&
        sameStyle(previous, item) &&
        gap >= -item.size * 0.2 &&
        gap <= Math.max(space(item) * 2.5, item.size * 0.55)
      ) {
        append(line, item);
      } else {
        line = { runs: [item], text: item.text, bounds: [...item.bounds] };
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
      const text = line.text.trimEnd();
      if (line.runs.length === 1 && text === first.text) return first;
      return { ...first, text, bounds: line.bounds, runs: line.runs };
    }),
  ].sort((a, b) => b.bounds[3] - a.bounds[3] || a.bounds[0] - b.bounds[0]);
}
