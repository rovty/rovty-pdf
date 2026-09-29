import type { NativeText } from './types';

/** PDF Tf size and the text matrix together determine the visible em size. */
export function textEmMatrix(item: Pick<NativeText, 'size' | 'matrix'>) {
  return (item.matrix?.slice(0, 4) || [1, 0, 0, 1]).map((value) => value * item.size);
}

export function hasHorizontalBaseline(item: Pick<NativeText, 'size' | 'matrix'>) {
  const [a, b, c, d] = textEmMatrix(item);
  // Italic shear changes c, not the baseline direction (a, b). Compare the
  // direction as a ratio so equivalent Tf/text-matrix scalings behave alike.
  return [a, b, c, d].every(Number.isFinite) && a > 0 && d > 0 && Math.abs(b / a) < 0.001;
}

export function visibleTextSize(item: Pick<NativeText, 'size' | 'matrix'>) {
  const [, , c, d] = textEmMatrix(item);
  // A horizontal italic shear changes the slant, not the font's em height.
  const size = hasHorizontalBaseline(item) ? d : Math.hypot(c, d);
  // Remove floating-point matrix noise without changing the source PDF values.
  return Number.isFinite(size) && size > 0 ? Math.round(size * 1e6) / 1e6 : item.size || 16;
}

export function sameTextTransform(
  a: Pick<NativeText, 'size' | 'matrix'>,
  b: Pick<NativeText, 'size' | 'matrix'>,
) {
  const other = textEmMatrix(b);
  return textEmMatrix(a).every((value, i) => Math.abs(value - other[i]) < 0.02);
}
