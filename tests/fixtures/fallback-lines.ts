import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export async function fallbackLinesFixture() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Reproduce the unavailable name with an open font; no Georgia redistribution.
  const subset = await doc.embedFont(await readFile('public/fonts/NotoSans-Bold.ttf'), {
    subset: true,
    customName: 'ABCDEF+Georgia-Bold',
  });
  const full = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawText('MENU', {
    font: subset,
    size: 24,
    x: 70,
    y: 650,
    rotate: degrees(8),
    color: rgb(0.2, 0.3, 0.5),
  });
  page.drawText('MENU', { font: subset, size: 24, x: 70, y: 550 });
  page.drawText('Working line', { font: full, size: 18, x: 70, y: 450 });
  doc.addPage([600, 800]).drawText('MENU', { font: subset, size: 24, x: 70, y: 650 });
  return doc.save();
}
