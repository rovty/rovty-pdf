import type { ProcessOptions } from './types';
import { parseRange } from './utils';

export function imagePageLayout(imageWidth: number, imageHeight: number, options: ProcessOptions) {
  let [width, height] =
    options.imageSize === 'fit'
      ? [imageWidth * 0.75 + options.margins * 2, imageHeight * 0.75 + options.margins * 2]
      : options.imageSize === 'letter'
        ? [612, 792]
        : [595.28, 841.89];
  if (options.imageSize !== 'fit' && options.orientation === 'landscape')
    [width, height] = [height, width];
  if (
    !Number.isFinite(options.margins) ||
    options.margins < 0 ||
    options.margins * 2 >= Math.min(width, height)
  )
    throw new Error('The margin is too large for this page size.');
  const factor = Math.min(
    (width - options.margins * 2) / imageWidth,
    (height - options.margins * 2) / imageHeight,
  );
  const drawnWidth = imageWidth * factor,
    drawnHeight = imageHeight * factor;
  return {
    width,
    height,
    x: (width - drawnWidth) / 2,
    y: (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  };
}

export function splitPageGroups(count: number, options: ProcessOptions): number[][] {
  let groups: number[][];
  if (options.splitMode === 'pages') groups = Array.from({ length: count }, (_, index) => [index]);
  else if (options.splitMode === 'every') {
    if (!Number.isInteger(options.every) || options.every < 1)
      throw new Error('Choose at least one page per PDF.');
    groups = Array.from({ length: Math.ceil(count / options.every) }, (_, group) =>
      Array.from(
        { length: Math.min(options.every, count - group * options.every) },
        (_, offset) => group * options.every + offset,
      ),
    );
  } else {
    if (!options.range.trim())
      throw new Error('Enter ranges separated by commas, such as 1-3, 4-6.');
    groups = options.range.split(',').map((range) => parseRange(range, count, false));
  }
  if (groups.length > 200)
    throw new Error('Split up to 200 output files at a time. Try splitting every few pages.');
  return groups;
}
