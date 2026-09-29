export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function outputName(name: string, suffix: string, extension = 'pdf') {
  return `${
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .slice(0, 120) || 'document'
  }-${suffix}.${extension}`;
}
export function parseRange(input: string, count: number, emptyMeansAll = true): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('This document has no pages.');
  if (!input.trim()) {
    if (!emptyMeansAll) throw new Error('Enter at least one page number.');
    return Array.from({ length: count }, (_, i) => i);
  }
  const result: number[] = [];
  for (const group of input.split(',')) {
    const match = group.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers or ranges, like 1, 3-5, 8.');
    const start = Number(match[1]),
      end = Number(match[2] || match[1]);
    if (start < 1 || end < 1 || start > count || end > count)
      throw new Error(`Page numbers must be between 1 and ${count}.`);
    const step = start <= end ? 1 : -1;
    for (let page = start; ; page += step) {
      result.push(page - 1);
      if (page === end) break;
      if (result.length > 5000) throw new Error('The page selection is too large.');
    }
  }
  return [...new Set(result)];
}
export function inversePoint(t: number[], x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = t,
    det = a * d - b * c;
  return [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
}
export function transformPoint(t: number[], x: number, y: number): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function humanError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/password/i.test(text))
    return 'This PDF needs the correct password. Please open it again and enter its password.';
  if (/encrypt/i.test(text)) return 'Open this PDF with its password before editing it.';
  if (/invalid pdf|pdf structure|not a pdf|no pdf header|failed to parse/i.test(text))
    return 'This file could not be read as a PDF. Try another copy of the original file.';
  if (/out of memory|allocation|memory access/i.test(text))
    return 'This file is too large for the available browser memory. Try fewer pages or a smaller file.';
  return text || 'Something went wrong. Your original file has not been changed. Please try again.';
}
export function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
