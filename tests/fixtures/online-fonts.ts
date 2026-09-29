import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export async function onlineFontFixture(
  name: 'Aileron-Regular' | 'Poppins-Regular',
  pdfFontName: string = name,
) {
  const extension = name.startsWith('Aileron') ? 'otf' : 'ttf';
  const bytes = await readFile(`tests/fixtures/online-fonts/${name}-subset.${extension}`);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes, { subset: false, customName: `ABCDEF+${pdfFontName}` });
  doc.addPage([600, 800]).drawText('ABBA', { font, x: 70, y: 620, size: 24 });
  await doc.flush();
  if (extension === 'otf') {
    const root = doc.context.lookup(font.ref, PDFDict);
    const descendant = root.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const program = descriptor.get(PDFName.of('FontFile2'))!;
    const stream = doc.context.lookup(program);
    if (!(stream instanceof PDFRawStream)) throw new Error('Invalid fixture font.');
    descriptor.delete(PDFName.of('FontFile2'));
    descriptor.set(PDFName.of('FontFile3'), program);
    stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'));
    descendant.set(PDFName.of('Subtype'), PDFName.of('CIDFontType0'));
    descendant.delete(PDFName.of('CIDToGIDMap'));
  }
  return doc.save();
}
