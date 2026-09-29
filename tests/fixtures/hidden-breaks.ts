import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/** The visible space glyph extracts as CR/LF because of the source's character map. */
export async function hiddenBreaksFixture() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile('public/fonts/NotoSans-Regular.ttf'), {
    subset: false,
  });
  const page = doc.addPage([600, 800]);
  page.drawText('English line keeps spaces.', { font, size: 18, x: 60, y: 680 });
  page.drawText('Next line.', { font, size: 18, x: 60, y: 650 });
  await doc.flush();
  const dictionary = doc.context.lookup(font.ref, PDFDict);
  const ref = dictionary.get(PDFName.of('ToUnicode'))!;
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) throw new Error('Fixture has no character map stream.');
  const cmap = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  const changed = cmap.replace(/^(<[0-9a-f]+>)[ \t]+<0020>$/gim, '$1 <000D000A>');
  if (changed === cmap) throw new Error('Fixture could not find the space mapping.');
  doc.context.assign(ref as import('pdf-lib').PDFRef, doc.context.flateStream(changed));
  return doc.save();
}
