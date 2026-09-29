import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFString } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import { revealPdfArea } from './canvas';

async function document(page: Page, pages = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const sheet = pdf.addPage([612, 792]);
    sheet.drawText(`Editable line on page ${i + 1}`, { font, size: 18, x: 60, y: 700 });
  }
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'editing-review.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
}
async function draw(page: Page, from: number[], to: number[]) {
  await revealPdfArea(page, from, to);
  const svg = page.locator('.annotation-layer');
  const box = (await svg.boundingBox())!;
  const [, , width, height] = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  await page.mouse.move(
    box.x + (from[0] / width) * box.width,
    box.y + (from[1] / height) * box.height,
  );
  await page.mouse.down();
  await page.mouse.move(
    box.x + (to[0] / width) * box.width,
    box.y + (to[1] / height) * box.height,
    { steps: 5 },
  );
  await page.mouse.up();
}
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15000);
  await mkdir('tmp/qa', { recursive: true });
});

test('font size and page numbers preserve digits, clearing and decimal input', async ({ page }) => {
  await document(page, 14);
  await page.getByRole('button', { name: 'Edit: Editable line on page 1', exact: true }).click();
  const font = page.getByLabel('On-page font size', { exact: true });
  await font.focus();
  await font.press('ControlOrMeta+A');
  await font.pressSequentially('24', { delay: 60 });
  await expect(font).toHaveValue('24');
  await expect(page.getByLabel('Font size', { exact: true })).toHaveValue('24');
  await font.press('ControlOrMeta+A');
  await font.press('Backspace');
  await expect(font).toHaveValue('');
  await font.pressSequentially('14.5', { delay: 60 });
  await expect(font).toHaveValue('14.5');
  await expect(page.getByLabel('Font size', { exact: true })).toHaveValue('14.5');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(font).toHaveValue('14');
  await page.getByRole('button', { name: 'Finish editing text' }).click();
  const number = page.getByLabel('Current page', { exact: true });
  await number.focus();
  await number.press('ControlOrMeta+A');
  await number.press('Backspace');
  await expect(number).toHaveValue('');
  await number.pressSequentially('12', { delay: 60 });
  await expect(number).toHaveValue('12');
  await expect(
    page.getByRole('button', { name: 'Edit: Editable line on page 12', exact: true }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(number).toHaveValue('11');
  await number.fill('999');
  await number.press('Enter');
  await expect(number).toHaveValue('14');
});

for (const width of [1280, 390]) {
  test(`new links and forms reveal their required settings in focus view at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await document(page);
    await page.getByRole('button', { name: 'Focus view', exact: true }).click();
    const tools = page.getByRole('toolbar', { name: 'PDF editing tools' });
    await tools.getByRole('button', { name: 'Link', exact: true }).click();
    await draw(page, [80, 200], [220, 230]);
    const url = page.getByLabel('Destination URL', { exact: true });
    await expect(url).toBeFocused();
    await expect(url).toBeInViewport({ ratio: 1 });
    await url.fill('https://rovty.com');
    await page.getByRole('button', { name: 'Close tool settings' }).click();
    await tools.getByLabel('Create form field').selectOption('text');
    await draw(page, [80, 300], [220, 330]);
    const name = page.getByLabel('Field name', { exact: true });
    await expect(name).toBeFocused();
    await expect(name).toBeInViewport({ ratio: 1 });
    await name.fill('Contact name');
    await page.getByLabel('Default value').fill('Alex Sample');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
    const path = `tmp/qa/ux-link-form-${width}.pdf`;
    await (await pending).saveAs(path);
    const pdf = await PDFDocument.load(await readFile(path));
    expect(pdf.getForm().getTextField('Contact name').getText()).toBe('Alex Sample');
    const links = pdf
      .getPage(0)
      .node.Annots()!
      .asArray()
      .map((ref) => pdf.context.lookup(ref, PDFDict));
    expect(
      links.some(
        (link) =>
          link
            .lookupMaybe(PDFName.of('A'), PDFDict)
            ?.lookupMaybe(PDFName.of('URI'), PDFString)
            ?.decodeText() === 'https://rovty.com/',
      ),
    ).toBe(true);
    await page.screenshot({ path: `tmp/qa/ux-settings-${width}.png` });
  });
}

for (const signature of [false, true]) {
  test(`${signature ? 'signatures' : 'images'} are inserted inside the currently visible PDF area`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await document(page);
    await page.getByLabel('Canvas zoom', { exact: true }).selectOption('2');
    const viewport = page.locator('.editor-viewport');
    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = el.scrollWidth;
    });
    const before = await viewport.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
    if (signature) {
      await page
        .getByRole('toolbar')
        .getByRole('button', { name: 'Signature', exact: true })
        .click();
      await page.getByRole('button', { name: 'Type signature', exact: true }).click();
      await page.getByLabel('Your name', { exact: true }).fill('Alex Sample');
      await page.getByRole('button', { name: 'Use signature', exact: true }).click();
    } else {
      await page.getByLabel('Add image to PDF').setInputFiles('public/rovty-pdf-og.png');
    }
    await expect(page.locator('.annotation-paint-layer image')).toHaveCount(1);
    const image = (await page.locator('.annotation-paint-layer image').boundingBox())!;
    const view = (await viewport.boundingBox())!;
    expect(image.x).toBeGreaterThanOrEqual(view.x);
    expect(image.y).toBeGreaterThanOrEqual(view.y);
    expect(image.x + image.width).toBeLessThanOrEqual(view.x + view.width);
    expect(image.y + image.height).toBeLessThanOrEqual(view.y + view.height);
    expect(await viewport.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(
      before,
    );
    await page.screenshot({ path: `tmp/qa/ux-visible-${signature ? 'signature' : 'image'}.png` });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.annotation-paint-layer image')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.annotation-paint-layer image')).toHaveCount(1);
  });
}

test('export feedback keeps the canvas stable and can be dismissed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await document(page);
  const viewport = page.locator('.editor-viewport');
  const before = await viewport.boundingBox();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await pending;
  await expect(page.getByText('Your file is ready.', { exact: true })).toBeVisible();
  expect(await viewport.boundingBox()).toEqual(before);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Dismiss download notice' }).click();
  await expect(page.locator('.result-banner')).toHaveCount(0);
  expect(await viewport.boundingBox()).toEqual(before);
});
