import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export async function notoSerifFixture(text: 'MENU' | 'menu') {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile('tests/fixtures/online-fonts/NotoSerif-Bold-subset.ttf'),
    {
      subset: true,
      customName: 'ABCDEF+NotoSerif-Bold',
    },
  );
  doc.addPage([600, 400]).drawText(text, { font, x: 60, y: 300, size: 24 });
  return doc.save();
}
