import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { createSinhalaFont, embedSinhalaFont, drawSinhalaLine } from '../src/lib/sinhala.ts';
import { FontRecoveryError } from '../src/lib/fontRecovery.ts';

test('Sinhala replacement shapes clusters and keeps Unicode, color and rotated placement in PDFs', async () => {
  const text = 'Rovty ශ්‍රී ලංකාව කො කෝ කෞ ක්‍ර 2026';
  for (const variant of ['Regular', 'Bold']) {
    const data = await createSinhalaFont(
      await readFile(`public/fonts/sinhala/NotoSerifSinhala-${variant}.ttf`),
    );
    const joined = data.shape('ශ්‍රී');
    assert.equal(
      joined.glyphs.length,
      2,
      'joined consonant and vowel sign are shaped as two glyphs',
    );
    assert.ok(joined.glyphs.every((g) => g.cluster === 0));
    assert.ok(data.shape(text).width > 0);
    for (const word of ['කි', 'කෙ', 'කො', 'කෝ', 'කෞ', 'ශ්‍රී'])
      assert.ok(data.shape(word).glyphs.length > 0);
    assert.throws(() => data.shape('ි ක'), /vowel sign without its letter/);
    assert.throws(() => data.shape('漢字'), /cannot display a character/);
    const doc = await PDFDocument.create(),
      font = await embedSinhalaFont(doc, data);
    for (const rotation of [0, 90, 180, 270]) {
      const page = doc.addPage([650, 650]);
      page.setCropBox(25, 25, 600, 600);
      page.setRotation(degrees(rotation));
      const [x, y] = [
        [60, 500],
        [150, 60],
        [590, 150],
        [500, 590],
      ][rotation / 90];
      drawSinhalaLine(page, font, data, text, {
        x,
        y,
        size: 16,
        rotation,
        color: rgb(0.12, 0.3, 0.42),
        opacity: 0.8,
      });
    }
    await mkdir('tmp/qa', { recursive: true });
    const file = `tmp/qa/sinhala-${variant}.pdf`;
    await writeFile(file, await doc.save());
    const extracted = execFileSync('/opt/homebrew/bin/pdftotext', ['-raw', file, '-'], {
      encoding: 'utf8',
    });
    assert.equal(
      extracted.split(text).length - 1,
      4,
      'logical Sinhala Unicode survives on every rotated page',
    );
    const fontInfo = execFileSync('/opt/homebrew/bin/pdffonts', [file], { encoding: 'utf8' });
    assert.match(fontInfo, new RegExp(`NotoSerifSinhala-${variant}`));
    assert.match(fontInfo, /yes\s+no\s+yes/);
  }
});

test('Iskoola Pota errors explain the catalog limit and an explicit Sinhala replacement', () => {
  const error = new FontRecoveryError('ABCDEF+IskoolaPota-Bold', 'සිංහල');
  assert.match(error.message, /not available from Rovty’s free-font catalogs/);
  assert.match(error.message, /Noto Serif Sinhala/);
  assert.match(error.message, /different typeface/);
});
