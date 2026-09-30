import test from 'node:test';
import assert from 'node:assert/strict';
import { fullQuad, orderQuad, validQuad, scanPageLayout } from '../src/lib/scannerTypes';
test('scan crop accepts clockwise perspective corners and rejects crossed, tiny and invalid crops', () => {
  const quad = orderQuad([
    { x: 0.8, y: 0.9 },
    { x: 0.1, y: 0.8 },
    { x: 0.2, y: 0.1 },
    { x: 0.9, y: 0.2 },
  ]);
  assert.deepEqual(quad[0], { x: 0.2, y: 0.1 });
  assert.ok(validQuad(quad));
  assert.ok(validQuad(fullQuad()));
  assert.equal(validQuad([quad[0], quad[2], quad[1], quad[3]]), false);
  assert.equal(
    validQuad([
      { x: 0, y: 0 },
      { x: 0.01, y: 0 },
      { x: 0.01, y: 0.01 },
      { x: 0, y: 0.01 },
    ]),
    false,
  );
  assert.equal(validQuad([{ x: NaN, y: 0 }, ...fullQuad().slice(1)] as typeof quad), false);
});
test('scan page layout preserves receipts and never stretches landscape or portrait images', () => {
  const receipt = scanPageLayout(500, 4000, { paper: 'fit', margin: 18 });
  assert.equal(receipt.width / receipt.height, 1 / 8);
  assert.equal(receipt.x, 0);
  for (const size of [
    [2000, 3000],
    [3000, 1000],
  ]) {
    const layout = scanPageLayout(size[0], size[1], { paper: 'a4', margin: 18 });
    assert.equal(layout.drawnWidth / layout.drawnHeight, size[0] / size[1]);
    assert.ok(layout.x >= 17.99 && layout.y >= 17.99);
    assert.ok(layout.drawnWidth <= layout.width - 35.99);
    assert.ok(layout.drawnHeight <= layout.height - 35.99);
  }
});
