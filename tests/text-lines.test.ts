import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTextLines, textSources } from '../src/lib/textBlocks.ts';
import type { NativeText } from '../src/lib/types.ts';

function run(text: string, x: number, y = 700, extras: Partial<NativeText> = {}): NativeText {
  return {
    path: [x + y],
    text,
    bounds: [x, y - 2, x + text.length * 6, y + 10],
    size: 12,
    color: '#000000',
    opacity: 1,
    fontName: 'Example',
    fontEmbedded: true,
    fontResource: 1,
    matrix: [1, 0, 0, 1, x, y],
    advance: text.length * 6,
    spaceWidth: 3,
    ...extras,
  };
}

test('letters and words form one line with inferred spaces, regardless of object order', () => {
  const pieces = [
    run('H', 50),
    run('e', 56),
    run('l', 62),
    run('l', 68),
    run('o', 74),
    run('world', 83),
  ];
  const [line] = groupTextLines([...pieces].reverse());
  assert.equal(line.text, 'Hello world');
  assert.equal(textSources(line).length, 6);
  assert.deepEqual(line.bounds, [50, 698, 113, 710]);
});

test('related lines, columns and distant table cells remain separate selections', () => {
  const lines = groupTextLines([
    run('First ', 50),
    run('line', 86),
    run('Column', 320),
    run('Second ', 50, 684),
    run('line', 92, 684),
    run('Other cell', 320, 684),
  ]);
  assert.deepEqual(
    lines.map((line) => line.text),
    ['First line', 'Column', 'Second line', 'Other cell'],
  );
  assert.ok(lines.every((line) => !line.text.includes('\n')));
});

test('font changes, nested objects and vertical text are not flattened into a different style', () => {
  const items = [
    run('Normal', 50),
    run('Bold', 89, 700, { fontResource: 2, fontName: 'Example-Bold' }),
    run('Nested', 50, 650, { path: [3, 0] }),
    run('text', 89, 650, { path: [3, 1] }),
    run('Up', 50, 600, { matrix: [0, 1, -1, 0, 50, 600] }),
  ];
  assert.equal(groupTextLines(items).length, items.length);
  assert.ok(groupTextLines(items).every((line) => !line.runs));
});
