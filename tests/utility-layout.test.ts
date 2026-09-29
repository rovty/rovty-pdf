import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePageLayout, splitPageGroups } from '../src/lib/utilityLayout';
import { defaultOptions } from '../src/lib/types';

test('image previews and exports share aspect ratio, page size, orientation and margins', () => {
  const layout = imagePageLayout(800, 400, {
    ...defaultOptions,
    imageSize: 'letter',
    orientation: 'landscape',
    margins: 36,
  });
  assert.deepEqual(layout, {
    width: 792,
    height: 612,
    x: 36,
    y: 126,
    drawnWidth: 720,
    drawnHeight: 360,
  });
  assert.deepEqual(
    imagePageLayout(800, 400, { ...defaultOptions, imageSize: 'fit', margins: 20 }),
    { width: 640, height: 340, x: 20, y: 20, drawnWidth: 600, drawnHeight: 300 },
  );
  assert.throws(
    () => imagePageLayout(800, 400, { ...defaultOptions, imageSize: 'letter', margins: 400 }),
    /margin/,
  );
});

test('split preview groups match export order, including reversed ranges and incomplete final groups', () => {
  assert.deepEqual(splitPageGroups(5, { ...defaultOptions, splitMode: 'every', every: 2 }), [
    [0, 1],
    [2, 3],
    [4],
  ]);
  assert.deepEqual(
    splitPageGroups(5, { ...defaultOptions, splitMode: 'ranges', range: '3-1, 4-5' }),
    [
      [2, 1, 0],
      [3, 4],
    ],
  );
  assert.throws(() => splitPageGroups(3, { ...defaultOptions, splitMode: 'ranges', range: '1-7' }));
  assert.throws(() => splitPageGroups(201, { ...defaultOptions, splitMode: 'pages' }), /200/);
});
