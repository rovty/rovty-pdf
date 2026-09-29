import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cropSignature,
  removeSignatureBackground,
  type SignaturePixels,
} from '../src/lib/signature';

function paper(): SignaturePixels {
  const data = new Uint8ClampedArray(9 * 9 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([248, 244, 230, 255], i);
  return { data, width: 9, height: 9 };
}
test('signature removal clears off-white paper and enclosed areas while preserving blue ink', () => {
  const input = paper();
  for (const [x, y] of [
    [3, 3],
    [4, 3],
    [5, 3],
    [3, 4],
    [5, 4],
    [3, 5],
    [4, 5],
    [5, 5],
  ])
    input.data.set([20, 40, 130, 255], (y * 9 + x) * 4);
  const result = removeSignatureBackground(input, 30);
  assert.equal(result.data[3], 0);
  assert.equal(result.data[(4 * 9 + 4) * 4 + 3], 0);
  assert.deepEqual(
    [...result.data.slice((3 * 9 + 3) * 4, (3 * 9 + 3) * 4 + 4)],
    [20, 40, 130, 255],
  );
  assert.equal(
    input.data[3],
    255,
    'The original image must remain available for toggling removal off.',
  );
  const cropped = cropSignature(result);
  assert.equal(cropped.width, 19);
  assert.equal(cropped.height, 19);
});
test('lower removal strength preserves faint ink and existing transparency', () => {
  const input = paper();
  input.data.set([180, 180, 180, 180], (4 * 9 + 4) * 4);
  input.data.set([10, 20, 30, 0], (4 * 9 + 5) * 4);
  const gentle = removeSignatureBackground(input, 0),
    strong = removeSignatureBackground(input, 100);
  assert.equal(gentle.data[(4 * 9 + 4) * 4 + 3], 180);
  assert.equal(gentle.data[(4 * 9 + 5) * 4 + 3], 0);
  assert.equal(strong.data[(4 * 9 + 4) * 4 + 3], 0);
});
test('empty signatures produce a recoverable error and transparent images crop correctly', () => {
  assert.throws(
    () => cropSignature(removeSignatureBackground(paper(), 30)),
    /No signature is visible/,
  );
  const image = { data: new Uint8ClampedArray(36), width: 3, height: 3 };
  image.data.set([20, 40, 130, 127], 16);
  const result = cropSignature(image, 1);
  assert.equal(result.width, 3);
  assert.equal(result.height, 3);
  assert.deepEqual([...result.data.slice(16, 20)], [20, 40, 130, 127]);
});
