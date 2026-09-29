import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export async function latinModernFixture(variant = 'lmroman17-regular', rotated = false) {
  const bytes = await readFile(`tests/fixtures/latin-modern/${variant}-subset.otf`);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(bytes, {
    subset: false,
    customName: `ABCDEF+${fontkit.create(bytes).postscriptName}`,
  });
  document.addPage([600, 800]).drawText('ABBA', {
    font,
    size: 24,
    x: 70,
    y: 620,
    ...(rotated ? { rotate: degrees(12), xSkew: degrees(3) } : {}),
    color: rgb(0.2, 0.3, 0.5),
  });
  await document.flush();
  const root = document.context.lookup(font.ref, PDFDict);
  const descendant = root.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
  const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
  const program = descriptor.get(PDFName.of('FontFile2'))!;
  descriptor.delete(PDFName.of('FontFile2'));
  descriptor.set(PDFName.of('FontFile3'), program);
  const stream = document.context.lookup(program);
  if (!(stream instanceof PDFRawStream)) throw new Error('Invalid fixture font stream.');
  stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'));
  descendant.set(PDFName.of('Subtype'), PDFName.of('CIDFontType0'));
  descendant.delete(PDFName.of('CIDToGIDMap'));
  return document.save();
}
