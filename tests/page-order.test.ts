import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFDict, degrees } from 'pdf-lib';
import { editorPageOrder, movePage, reorderDocumentPages } from '../src/lib/pageOrder.ts';

test('page order rejects missing, duplicated and invalid pages without losing source identity', () => {
  const order = editorPageOrder(undefined, 4);
  assert.deepEqual(movePage(order, 0, 3), [1, 2, 3, 0]);
  assert.deepEqual(movePage(order, 3, 0), [3, 0, 1, 2]);
  assert.deepEqual(order, [0, 1, 2, 3]);
  assert.equal(movePage(order, 0, -1), order);
  for (const invalid of [
    [0, 0, 2, 3],
    [0, 1, 2],
    [0, 1, 2, 4],
    [0, 1, 2, 2.5],
  ])
    assert.throws(() => editorPageOrder(invalid, 4), /page order is invalid/);
});

test('reordering preserves page geometry, form widgets and internal link/bookmark references', async () => {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([600, 800]), doc.addPage([420, 600]), doc.addPage([700, 500])];
  pages[1].setCropBox(10, 20, 400, 560);
  pages[2].setRotation(degrees(90));
  const field = doc.getForm().createTextField('Account');
  field.setText('Kept on second page');
  field.addToPage(pages[1], { x: 40, y: 300, width: 180, height: 24 });
  const destination = doc.context.obj([pages[1].ref, 'Fit']);
  pages[0].node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [30, 30, 150, 50],
        Dest: destination,
      }),
    ),
  );
  doc.catalog.set(PDFName.of('OpenAction'), destination);
  const references = pages.map((page) => page.ref.toString());
  reorderDocumentPages(doc, [2, 0, 1]);
  const reopened = await PDFDocument.load(await doc.save());
  assert.deepEqual(
    reopened.getPages().map((page) => page.ref.toString()),
    [references[2], references[0], references[1]],
  );
  assert.equal(reopened.getPage(0).getRotation().angle, 90);
  assert.deepEqual(reopened.getPage(2).getCropBox(), { x: 10, y: 20, width: 400, height: 560 });
  const kept = reopened.getForm().getTextField('Account');
  assert.equal(kept.getText(), 'Kept on second page');
  assert.equal(kept.acroField.getWidgets()[0].P()?.toString(), references[1]);
  const link = reopened.getPage(1).node.Annots()!.lookup(0, PDFDict);
  assert.equal(link.lookup(PDFName.of('Dest'), PDFArray).get(0).toString(), references[1]);
  assert.equal(
    reopened.catalog.lookup(PDFName.of('OpenAction'), PDFArray).get(0).toString(),
    references[1],
  );
  const before = reopened.getPages().map((page) => page.ref.toString());
  assert.throws(() => reorderDocumentPages(reopened, [0, 0, 1]), /invalid/);
  assert.deepEqual(
    reopened.getPages().map((page) => page.ref.toString()),
    before,
  );
});
