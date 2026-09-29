import { readFile } from 'node:fs/promises';
import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
} from 'pdf-lib';
import { createSinhalaFont, embedSinhalaFont, drawSinhalaLine } from '../../src/lib/sinhala';

export const sinhalaLines = [
  'අපි ශ්‍රී ලංකාවේ සිංහල ලියමු',
  'Rovty ශ්‍රී ලංකාව කො කෝ කෞ ක්‍ර 2026',
];
export const sinhalaColumn = 'වෙනම තීරුව';

/** Real shaped glyphs, independent word spans and duplicate font resources. */
export async function sinhalaLinesFixture(fragmented = true, unitFontSize = false) {
  const data = await createSinhalaFont(
    await readFile('public/fonts/sinhala/NotoSerifSinhala-Regular.ttf'),
  );
  const doc = await PDFDocument.create();
  const fonts = [await embedSinhalaFont(doc, data), await embedSinhalaFont(doc, data)];
  const page = doc.addPage([800, 800]);
  const scale = unitFontSize ? 20 : 1;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(scale, 0, 0, scale, 0, 0));
  const words: { text: string; x: number; y: number; font: number }[] = [];
  for (const [row, line] of sinhalaLines.entries()) {
    let x = 60;
    for (const [i, word] of (fragmented ? line.split(' ') : [line]).entries()) {
      words.push({ text: word, x, y: 680 - row * 45, font: i % 2 });
      x += data.shape(word + ' ').width * 20;
    }
  }
  words.push({ text: sinhalaColumn, x: 600, y: 680, font: 0 });
  for (const word of words.reverse()) {
    drawSinhalaLine(page, fonts[word.font], data, word.text, {
      x: word.x / scale,
      y: word.y / scale,
      size: 20 / scale,
      rotation: 0,
      color: rgb(0, 0, 0),
      opacity: 1,
    });
  }
  page.pushOperators(popGraphicsState());
  return doc.save();
}
