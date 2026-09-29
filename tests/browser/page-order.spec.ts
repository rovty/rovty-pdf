import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

async function fixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = ['First page.', 'Second page.', 'Third page.'].map((text) => {
    const page = doc.addPage([600, 800]);
    page.drawText(text, { font, size: 24, x: 60, y: 680 });
    return page;
  });
  const field = doc.getForm().createTextField('Account');
  field.setText('Saved value');
  field.addToPage(pages[1], { x: 60, y: 550, width: 200, height: 30 });
  pages[0].node.addAnnot(
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [60, 600, 200, 630],
        Dest: [pages[1].ref, 'Fit'],
      }),
    ),
  );
  return doc.save();
}
async function ready(page: Page) {
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-stage .page-loading')).toHaveCount(0);
  await expect(page.locator('.text-edit-error')).toHaveCount(0);
}
async function open(page: Page) {
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await fixture()),
  });
  await ready(page);
}
async function order(page: Page) {
  return page
    .locator('[data-editor-page]')
    .evaluateAll((tiles) => tiles.map((tile) => Number((tile as HTMLElement).dataset.editorPage)));
}
async function save(page: Page, name: string) {
  await mkdir('tmp/qa', { recursive: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = `tmp/qa/${name}.pdf`;
  await (await download).saveAs(path);
  return path;
}

test('editor thumbnails drag into order with undo and edits, forms and destinations on the right pages', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Edit: First page.', exact: true }).click();
  await page.getByLabel('Edit text on page', { exact: true }).fill('Edited first.');
  await ready(page);
  const first = page.getByRole('button', { name: 'Open page 1', exact: true });
  const third = page.getByRole('button', { name: 'Open page 3', exact: true });
  await first.scrollIntoViewIfNeeded();
  let start = (await first.boundingBox())!,
    end = (await third.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + 35);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + 35, { steps: 10 });
  await expect(page.locator('.drop-after')).toHaveAttribute('data-editor-page', '2');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await order(page)).toEqual([0, 1, 2]);
  await first.dragTo(third);
  expect(await order(page)).toEqual([1, 2, 0]);
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('3');
  await expect(page.locator('.page-stage canvas.pdf-canvas')).toHaveAttribute(
    'aria-label',
    'PDF page 3',
  );
  await expect(page.locator('.editor-page-tile.current-page')).toHaveAttribute(
    'data-editor-page',
    '0',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await order(page)).toEqual([0, 1, 2]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await order(page)).toEqual([1, 2, 0]);
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await ready(page);
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Edit: Third page.', exact: true }).click();
  await page.getByLabel('Edit text on page', { exact: true }).fill('Edited third.');
  await ready(page);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await ready(page);
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('3');
  await page.getByRole('button', { name: 'Page thumbnails', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Page order', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Page thumbnails', exact: true }).click();
  const path = await save(page, 'editor-page-order');
  const text = execFileSync('/opt/homebrew/bin/pdftotext', ['-layout', path, '-'])
    .toString()
    .split('\f');
  expect(text[0]).toContain('Second page.');
  expect(text[1]).toContain('Edited third.');
  expect(text[2]).toContain('Edited first.');
  const doc = await PDFDocument.load(await readFile(path));
  expect(doc.getForm().getTextField('Account').getText()).toBe('Saved value');
  expect(doc.getForm().getTextField('Account').acroField.getWidgets()[0].P()?.toString()).toBe(
    doc.getPage(0).ref.toString(),
  );
  const link = doc.getPage(2).node.Annots()!.lookup(0, PDFDict);
  expect(link.lookup(PDFName.of('Dest'), PDFArray).get(0).toString()).toBe(
    doc.getPage(0).ref.toString(),
  );
  await page.getByRole('button', { name: 'Find & replace', exact: true }).click();
  await page.getByLabel('Find text', { exact: true }).fill('Edited');
  const matches = page.locator('.find-results button');
  await expect(matches).toHaveCount(2);
  await expect(matches.nth(0)).toContainText('Page 2');
  await expect(matches.nth(0)).toContainText('Edited third.');
  await expect(matches.nth(1)).toContainText('Page 3');
  await expect(matches.nth(1)).toContainText('Edited first.');
  await matches.nth(0).click();
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Close find and replace', exact: true }).click();
  await page.getByRole('button', { name: 'Open page 3', exact: true }).click();
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '3',
    '-singlefile',
    '-scale-to',
    '1000',
    '-png',
    path,
    'tmp/qa/editor-page-order',
  ]);
  await page.screenshot({ path: 'tmp/qa/editor-page-order-desktop.png', fullPage: true });
});

test.describe('touch page reordering', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('grip dragging reorders pages and touch cancellation keeps the order', async ({
    page,
    context,
  }) => {
    await open(page);
    const client = await context.newCDPSession(page);
    async function drag(cancel = false) {
      const grip = page.getByRole('button', { name: 'Drag page 1', exact: true });
      await grip.scrollIntoViewIfNeeded();
      const from = (await grip.boundingBox())!;
      const target = (await page
        .getByRole('button', { name: 'Drag page 2', exact: true })
        .boundingBox())!;
      const x = from.x + from.width / 2,
        y = from.y + from.height / 2;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 8; step++)
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x + ((target.x - from.x) * step) / 8, y }],
        });
      await expect(page.locator('.drop-after')).toBeVisible();
      await client.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
    }
    await drag(true);
    expect(await order(page)).toEqual([0, 1, 2]);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    await drag();
    expect(await order(page)).toEqual([1, 0, 2]);
    await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('2');
    await page.getByRole('button', { name: 'Move page 2 earlier', exact: true }).click();
    expect(await order(page)).toEqual([0, 1, 2]);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await order(page)).toEqual([1, 0, 2]);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Close document', exact: true }).click();
    expect(await order(page)).toEqual([1, 0, 2]);
    const path = await save(page, 'editor-page-order-touch');
    const text = execFileSync('/opt/homebrew/bin/pdftotext', ['-layout', path, '-'])
      .toString()
      .split('\f');
    expect(text[0]).toContain('Second page.');
    expect(text[1]).toContain('First page.');
    await page.getByRole('button', { name: 'Open page 2', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'tmp/qa/editor-page-order-mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await client.detach();
  });
});
