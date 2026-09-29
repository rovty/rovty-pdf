import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTextLines, textSources } from '../src/lib/textBlocks.ts';
import type { NativeText } from '../src/lib/types.ts';
import { visibleTextSize } from '../src/lib/textMetrics.ts';

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

test('synthetic italic letters group on their baseline without changing their em height', () => {
  for (const shear of [-0.25, 0.25]) {
    const pieces = [
      run('I', 50),
      run('t', 56),
      run('a', 62),
      run('l', 68),
      run('i', 74),
      run('c', 80),
      run('words', 89),
    ].map((item, index) => ({
      ...item,
      size: index % 2 ? 1 : 12,
      matrix:
        index % 2
          ? [12, 0, shear * 12, 12, item.matrix![4], 700]
          : [1, 0, shear, 1, item.matrix![4], 700],
    }));
    const lines = groupTextLines([...pieces].reverse());
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, 'Italic words');
    assert.equal(visibleTextSize(lines[0]), 12);
    assert.deepEqual(textSources(lines[0]), pieces);
  }
});

test('italic grouping keeps different slants, neighboring lines and columns separate', () => {
  const italic = (text: string, x: number, y = 700) =>
    run(text, x, y, { matrix: [1, 0, 0.25, 1, x, y] });
  const pieces = [
    italic('Italic', 50),
    italic('line', 89),
    italic('Column', 320),
    italic('Next', 50, 684),
    italic('line', 77, 684),
    run('Regular', 104, 684),
    run('Other slant', 149, 684, { matrix: [1, 0, -0.25, 1, 149, 684] }),
    run('Angled', 50, 650, { matrix: [1, 0.2, 0.25, 1, 50, 650] }),
    run('text', 89, 658, { matrix: [1, 0.2, 0.25, 1, 89, 658] }),
  ];
  const lines = groupTextLines(pieces);
  assert.deepEqual(
    lines.filter((line) => line.bounds[1] > 670).map((line) => line.text),
    ['Italic line', 'Column', 'Next line', 'Regular', 'Other slant'],
  );
  assert.equal(lines.filter((line) => line.text === 'Angled' || line.text === 'text').length, 2);
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

test('Sinhala words use rendered widths and combine duplicate font resources', () => {
  const pieces = [
    run('අපි', 50, 700, {
      bounds: [50, 698, 70, 713],
      advance: 70,
      fontName: 'ABCDEF+IskoolaPota',
    }),
    run('සිංහල', 74, 700, {
      bounds: [74, 696, 105, 716],
      fontResource: 2,
      fontName: 'GHIJKL+IskoolaPota',
    }),
    run('ලියමු', 109, 700, {
      bounds: [109, 696, 136, 712],
      fontResource: 3,
      fontName: 'IskoolaPota',
    }),
  ];
  const lines = groupTextLines(pieces.reverse());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'අපි සිංහල ලියමු');
  assert.deepEqual(lines[0].bounds, [50, 696, 136, 716]);
});

test('Sinhala raised signs and pre-base vowels stay with their consonants without extra spaces', () => {
  const pieces = [
    run('ක', 50, 700, { bounds: [50, 698, 60, 710], advance: 10 }),
    run('ි', 58, 705, { bounds: [56, 710, 60, 716], advance: 0 }),
    run('ෙ', 64, 700, { bounds: [64, 698, 70, 710], advance: 6 }),
    run('ක', 70, 700, { bounds: [70, 698, 80, 710], advance: 10 }),
  ];
  const lines = groupTextLines(pieces.reverse());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'කි කෙ');
  assert.equal(textSources(lines[0]).length, 4);
});

test('Sinhala grouping keeps rows, columns and style changes separate', () => {
  const pieces = [
    run('අපි', 50),
    run('ලියමු', 72),
    run('තීරුව', 320),
    run('ඊළඟ', 50, 680),
    run('පෙළ', 72, 680),
    run('තද', 98, 680, { fontName: 'Example-Bold', fontResource: 2 }),
  ];
  assert.deepEqual(
    groupTextLines(pieces).map((line) => line.text),
    ['අපි ලියමු', 'තීරුව', 'ඊළඟ පෙළ', 'තද'],
  );
});

test('grouped words retain all underlying glyph objects', () => {
  const a = run('අ', 50),
    b = run('පි', 56),
    c = run('සිංහල', 76);
  const word = {
    ...a,
    text: 'අපි',
    bounds: [50, 698, 68, 710] as NativeText['bounds'],
    runs: [{ ...a, runs: [a, b] }],
  };
  const [line] = groupTextLines([word, c]);
  assert.deepEqual(
    textSources(line).map((item) => item.path),
    [a.path, b.path, c.path],
  );
});

test('scaled size-one Sinhala keeps detached signs on the correct line and in Unicode order', () => {
  const pieces = [
    run('ක', 50, 700, { bounds: [50, 698, 60, 710], advance: 10 }),
    run('ි', 58, 705, { bounds: [56, 710, 60, 716], advance: 0 }),
    run('ෙ', 64, 700, { bounds: [64, 698, 70, 710], advance: 6 }),
    run('ක', 70, 700, { bounds: [70, 698, 80, 710], advance: 10 }),
  ].map((item, i) =>
    i % 2 ? { ...item, size: 1, matrix: [12, 0, 0, 12, item.matrix![4], item.matrix![5]] } : item,
  );
  const lines = groupTextLines(pieces.reverse());
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'කි කෙ');
  assert.equal(visibleTextSize(lines[0]), 12);
});
