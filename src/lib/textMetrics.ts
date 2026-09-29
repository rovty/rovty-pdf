import type { NativeText } from './types';

/** PDF Tf size and the text matrix together determine the visible em size. */
export function textEmMatrix(item: Pick<NativeText, 'size' | 'matrix'>) {
  return (item.matrix?.slice(0, 4) || [1, 0, 0, 1]).map((value) => value * item.size);
}

export function visibleTextSize(item: Pick<NativeText, 'size' | 'matrix'>) {
  const [, , c, d] = textEmMatrix(item);
  const size = Math.hypot(c, d);
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
