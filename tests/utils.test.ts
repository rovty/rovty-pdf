import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange, inversePoint, transformPoint, outputName } from '../src/lib/utils';

test('page selection preserves order, expands ranges and removes duplicates', () => {
  assert.deepEqual(parseRange('1, 3-5, 3, 2', 5), [0, 2, 3, 4, 1]);
  assert.deepEqual(parseRange('5-3', 5), [4, 3, 2]);
  assert.deepEqual(parseRange('', 3), [0, 1, 2]);
});
test('invalid page selections fail before modifying a document', () => {
  for (const input of ['0', '6', '1-7', '1,,2', '-1', '2.5', 'all', '1-2-3'])
    assert.throws(() => parseRange(input, 5));
  assert.throws(() => parseRange('', 5, false));
  assert.throws(() => parseRange('', 0));
});
test('coordinate conversion round-trips rotated and cropped pages', () => {
  for (const matrix of [
    [1, 0, 0, -1, 0, 842],
    [0, 1, 1, 0, -20, -40],
    [-1, 0, 0, 1, 600, -25],
    [0, -1, -1, 0, 800, 620],
  ]) {
    const point = transformPoint(matrix, 75.5, 190.25);
    assert.deepEqual(inversePoint(matrix, ...point), [75.5, 190.25]);
  }
});
test('download names are safe and preserve useful base filenames', () => {
  assert.equal(outputName('my.report.pdf', 'edited'), 'my.report-edited.pdf');
  assert.equal(outputName('../../private.pdf', 'images', 'zip'), '.._.._private-images.zip');
});
