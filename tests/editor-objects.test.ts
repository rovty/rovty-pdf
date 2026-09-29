import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString, PDFDict } from 'pdf-lib';
import {
  addFormFields,
  readLinks,
  removeChangedLinks,
  safeLink,
  unchangedLink,
} from '../src/lib/editorObjects.ts';
import type { Mark, SourceFile } from '../src/lib/types.ts';

async function fixture() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  const source: SourceFile = {
    id: 'test',
    name: 'test.pdf',
    bytes: await doc.save(),
    size: 0,
    pages: [0, 1].map(() => ({
      width: 600,
      height: 800,
      rotation: 0,
      transform: [1, 0, 0, -1, 0, 800],
    })),
  };
  return { doc, source };
}
const field = (name: string, type: Mark['formType'], other: Partial<Mark> = {}): Mark => ({
  id: name,
  kind: 'form',
  page: 0,
  x: 70,
  y: 80,
  width: 160,
  height: 25,
  color: '#000000',
  fontSize: 12,
  opacity: 1,
  strokeWidth: 1,
  fieldName: name,
  formType: type,
  ...other,
});
test('form creation rejects conflicting names, invalid choices and conflicting radio defaults', async () => {
  let { doc, source } = await fixture();
  assert.throws(
    () => addFormFields(doc, source, [field('Name', 'text'), field('Name', 'checkbox')]),
    /already used/,
  );
  ({ doc, source } = await fixture());
  assert.throws(
    () =>
      addFormFields(doc, source, [
        field('Plan', 'select', { fieldOptions: ['One'], fieldValue: 'Two' }),
      ]),
    /must match/,
  );
  ({ doc, source } = await fixture());
  assert.throws(
    () =>
      addFormFields(doc, source, [
        field('Contact', 'radio', { fieldValue: 'Email', checked: true }),
        field('Contact', 'radio', { fieldValue: 'Phone', checked: true }),
      ]),
    /only one/,
  );
});
test('form widgets preserve placement and radio grouping through a PDF round trip', async () => {
  const { doc, source } = await fixture();
  addFormFields(doc, source, [
    field('Notes', 'multiline', { fieldValue: 'One\nTwo' }),
    field('Choice', 'radio', { fieldValue: 'A' }),
    field('Choice', 'radio', { fieldValue: 'B', checked: true, page: 1 }),
  ]);
  const output = await PDFDocument.load(await doc.save());
  assert.equal(output.getForm().getTextField('Notes').isMultiline(), true);
  assert.equal(output.getForm().getTextField('Notes').getText(), 'One\nTwo');
  assert.deepEqual(output.getForm().getRadioGroup('Choice').getOptions(), ['A', 'B']);
  assert.equal(output.getForm().getRadioGroup('Choice').getSelected(), 'B');
  const bounds = output.getForm().getTextField('Notes').acroField.getWidgets()[0].getRectangle();
  assert.equal(bounds.x, 69.5);
  assert.equal(bounds.y, 694.5);
});
test('selecting an existing named link preserves it and deleting it preserves adjacent annotations', async () => {
  const { doc, source } = await fixture();
  const page = doc.getPage(0);
  page.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [70, 600, 170, 630],
        Dest: PDFString.of('chapter'),
      }),
    ),
  );
  page.node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [20, 20, 40, 40],
        Contents: PDFString.of('Keep me'),
      }),
    ),
  );
  source.bytes = await doc.save();
  const [link] = await readLinks(source);
  assert.equal(unchangedLink(link), true);
  removeChangedLinks(doc, [link]);
  assert.equal(page.node.Annots()!.size(), 2);
  removeChangedLinks(doc, [{ ...link, deleted: true }]);
  assert.equal(page.node.Annots()!.size(), 1);
  assert.equal(
    doc.context.lookup(page.node.Annots()!.get(0), PDFDict).get(PDFName.of('Subtype')),
    PDFName.of('Text'),
  );
});
test('external links reject executable and local protocols', () => {
  assert.equal(safeLink('https://rovty.com'), 'https://rovty.com/');
  assert.equal(safeLink('mailto:hello@rovty.com'), 'mailto:hello@rovty.com');
  for (const link of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/test', 'rovty.com'])
    assert.throws(() => safeLink(link), /Links must|Enter a complete/);
});
