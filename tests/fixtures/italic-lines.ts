import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';

export const italicLines = ['Synthetic italic words.', 'Office italic text.', 'Bold italic words.'];
export async function italicLinesFixture(updated = false) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Embed real italic outlines so visual checks do not depend on the viewer's
  // installed substitute fonts for unembedded Times/Helvetica references.
  const fonts = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    readFile('public/fonts/NotoSans-Italic.ttf').then((bytes) => doc.embedFont(bytes)),
    readFile('public/fonts/NotoSans-BoldItalic.ttf').then((bytes) => doc.embedFont(bytes)),
  ]);
  const page = doc.addPage([600, 800]);
  for (let row = 0; row < italicLines.length; row++) {
    const font = fonts[row],
      y = 700 - row * 60;
    const format = {
      font,
      size: 18,
      ySkew: degrees(row === 0 ? 12 : 0),
      color: rgb(0.2, 0.3, 0.5),
    };
    if (updated) {
      page.drawText(
        ['Updated italic words.', 'Updated italic text.', 'Updated bold italic.'][row],
        { ...format, x: 60, y },
      );
      continue;
    }
    let x = 60;
    const letters: { text: string; x: number; y: number }[] = [];
    for (const letter of italicLines[row]) {
      if (letter !== ' ') letters.push({ text: letter, x, y });
      x += font.widthOfTextAtSize(letter, 18);
    }
    // Some authoring apps store each glyph separately, in arbitrary order.
    for (const { text, ...position } of letters.reverse())
      page.drawText(text, { ...format, ...position });
  }
  page.drawText('Separate column', {
    font: fonts[0],
    size: 18,
    ySkew: degrees(12),
    x: 400,
    y: 700,
  });
  return doc.save();
}
