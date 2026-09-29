import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// An open bold font reproduces the missing-case problem without bundling Georgia.
export async function caseSubsetFixture(text: string, subset = true) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await readFile('public/fonts/NotoSans-Bold.ttf'), {
    subset,
    customName: 'NotoSans-Bold',
  });
  document.addPage([600, 400]).drawText(text, { font, size: 24, x: 60, y: 300 });
  return document.save();
}
