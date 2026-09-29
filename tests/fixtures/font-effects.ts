import { readFile } from 'node:fs/promises';
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  rgb,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export type FontEffect =
  'supported' | 'clip' | 'blend' | 'soft-mask' | 'actual-text' | 'complex-tag';
export async function fontEffectsFixture(
  effect: FontEffect = 'supported',
  replacement?: 'serif' | 'sans',
) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(
      replacement === 'serif'
        ? 'public/fonts/fallback/NotoSerif-Bold.ttf'
        : 'public/fonts/NotoSans-Bold.ttf',
    ),
    {
      subset: !replacement,
      customName: replacement ? undefined : 'ABCDEF+Georgia-Bold',
    },
  );
  const full = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([600, 800]);
  page.drawRectangle({ x: 0, y: 0, width: 600, height: 800, color: rgb(0.91, 0.96, 0.99) });
  // Real document structure links, so the test checks more than a tag label.
  const root = doc.context.obj({ Type: 'StructTreeRoot' });
  const rootRef = doc.context.register(root);
  const element = doc.context.register(
    doc.context.obj({ Type: 'StructElem', S: 'P', P: rootRef, Pg: page.ref, K: 0 }),
  );
  root.set(PDFName.of('K'), doc.context.obj([element]));
  root.set(
    PDFName.of('ParentTree'),
    doc.context.register(doc.context.obj({ Nums: [0, [element]] })),
  );
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
  doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
  page.node.set(PDFName.of('StructParents'), PDFNumber.of(0));
  const params = doc.context.obj({
    MCID: 0,
    Lang: PDFHexString.fromText('en-US'),
    Confidence: 0.75,
  });
  if (effect === 'actual-text') params.set(PDFName.of('ActualText'), PDFHexString.fromText('MENU'));
  if (effect === 'complex-tag') params.set(PDFName.of('Custom'), doc.context.obj([1, 2, 3]));
  page.pushOperators(
    pushGraphicsState(),
    rectangle(0, 0, effect === 'clip' ? 120 : 600, 800),
    clip(),
    endPath(),
  );
  if (effect === 'blend' || effect === 'soft-mask') {
    const state = doc.context.obj({ Type: 'ExtGState', BM: 'Multiply' });
    if (effect === 'soft-mask') {
      state.delete(PDFName.of('BM'));
      const group = doc.context.register(
        doc.context.flateStream('1 g 0 0 600 800 re f', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 600, 800],
          Resources: {},
          Group: { S: 'Transparency', CS: 'DeviceGray' },
        }),
      );
      state.set(PDFName.of('SMask'), doc.context.obj({ S: 'Luminosity', G: group }));
    }
    const key = page.node.newExtGState('Effects', doc.context.register(state));
    page.pushOperators(PDFOperator.of('gs' as PDFOperatorNames, [key]));
  }
  page.node.Resources()!.set(PDFName.of('Properties'), doc.context.obj({ Tag: params }));
  page.pushOperators(
    PDFOperator.of('BDC' as PDFOperatorNames, [PDFName.of('P'), PDFName.of('Tag')]),
  );
  page.drawText(replacement ? 'Menu café' : 'MENU', {
    font,
    size: 24,
    x: 70,
    y: 650,
    rotate: degrees(8),
    color: rgb(0.2, 0.3, 0.5),
    opacity: 115 / 255,
  });
  page.pushOperators(PDFOperator.of('EMC' as PDFOperatorNames), popGraphicsState());
  page.drawText('Nearby text stays unchanged', { font: full, size: 18, x: 70, y: 540 });
  return doc.save();
}
