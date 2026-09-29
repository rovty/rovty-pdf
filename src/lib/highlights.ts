import type { HighlightRect } from './types';

/** Merge adjacent text fragments without extending a selection to the whole line. */
export function highlightGeometry(rects: HighlightRect[], width: number, height: number) {
  const clipped = rects
    .map((rect) => {
      const x = Math.max(0, rect.x),
        y = Math.max(0, rect.y);
      return {
        x,
        y,
        width: Math.min(width, rect.x + rect.width) - x,
        height: Math.min(height, rect.y + rect.height) - y,
      };
    })
    .filter(
      (rect) => rect.width > 0.1 && rect.height > 0.1 && Object.values(rect).every(Number.isFinite),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: HighlightRect[] = [];
  for (const rect of clipped) {
    const previous = merged.find(
      (item) =>
        Math.abs(item.y - rect.y) < 0.5 &&
        Math.abs(item.height - rect.height) < 0.5 &&
        rect.x <= item.x + item.width + 1 &&
        rect.x + rect.width >= item.x - 1,
    );
    if (previous) {
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      previous.x = Math.min(previous.x, rect.x);
      previous.width = right - previous.x;
    } else merged.push({ ...rect });
  }
  if (!merged.length) return;
  const x = Math.min(...merged.map((r) => r.x)),
    y = Math.min(...merged.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...merged.map((r) => r.x + r.width)) - x,
    height: Math.max(...merged.map((r) => r.y + r.height)) - y,
    highlightRects: merged.map((r) => ({ ...r, x: r.x - x, y: r.y - y })),
  };
}
