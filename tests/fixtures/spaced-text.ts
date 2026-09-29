import { PDFDocument, StandardFonts } from 'pdf-lib';

/** Word gaps encoded as TJ positioning, without space characters in the string. */
export async function spacedTextFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([600, 800]);
  const key = page.node.newFontDictionary('Original', font.ref);
  page.node.addContentStream(
    doc.context.register(
      doc.context.flateStream(
        `BT ${key} 18 Tf 1 0 0 1 60 680 Tm [(R) 30 (elated) -250 (line) -250 (keeps) -250 (spaces.)] TJ ET`,
      ),
    ),
  );
  page.drawText('A separate column.', { font, size: 18, x: 390, y: 680 });
  page.drawText('Next  line stays separate.', { font, size: 18, x: 60, y: 650 });
  return doc.save();
}
