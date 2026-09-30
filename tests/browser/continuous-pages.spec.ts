import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

async function fixture(count = 4) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < count; index++) {
    const sheet = doc.addPage(index === 1 ? [500, 700] : [600, 800]);
    sheet.drawText(`Document page ${index + 1}`, {
      x: 50,
      y: sheet.getHeight() - 75,
      size: 18,
      font,
    });
    sheet.drawText(`Bottom of page ${index + 1}`, { x: 50, y: 70, size: 12, font });
    for (let line = 0; line < 4; line++)
      sheet.drawText(`Close line ${line + 1} on page ${index + 1}`, {
        x: 50,
        y: sheet.getHeight() - 140 - line * 12,
        size: 12,
        font,
      });
  }
  return doc.save();
}
async function open(page: Page, count = 4) {
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'continuous-pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await fixture(count)),
  });
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
}
const sheet = (page: Page, index: number) =>
  page.locator(`.page-stage[data-source-page="${index}"]`);
async function align(page: Page, index: number, top = 18) {
  await sheet(page, index).evaluate((stage, top) => {
    const view = stage.closest('.editor-viewport')!;
    view.scrollTop += stage.getBoundingClientRect().top - view.getBoundingClientRect().top - top;
  }, top);
}

test('wheel scroll crosses pages, edits the visible page and exports in the correct order', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(page.locator('.page-stage')).toHaveCount(4);
  await sheet(page, 1).evaluate((stage) => {
    const view = stage.closest('.editor-viewport')!;
    view.scrollTop +=
      stage.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientHeight + 80;
  });
  const view = (await page.locator('.editor-viewport').boundingBox())!;
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.wheel(0, view.height * 0.8);
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('2');
  await expect(sheet(page, 1).locator('canvas')).toHaveAttribute('data-ready', 'true');
  await sheet(page, 1).getByRole('button', { name: 'Edit: Document page 2', exact: true }).click();
  await page.getByLabel('Edit text on page', { exact: true }).fill('Changed second page');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Finish editing text', exact: true }).click();
  await page.getByRole('button', { name: 'Open page 4', exact: true }).click();
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('4');
  await expect(sheet(page, 3)).toBeInViewport();
  await page.getByRole('button', { name: 'Focus view', exact: true }).click();
  await expect(sheet(page, 3)).toBeInViewport({ ratio: 0.99 });
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('4');
  await page.getByLabel('Canvas zoom', { exact: true }).selectOption('1.5');
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('4');
  await page.getByRole('button', { name: 'Exit focus view', exact: true }).click();
  await page.getByRole('button', { name: 'Open page 1', exact: true }).click();
  await page.getByRole('button', { name: 'Move page 1 later', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.page-stage')
        .evaluateAll((stages) => stages.map((stage) => stage.getAttribute('data-source-page'))),
    )
    .toEqual(['1', '0', '2', '3']);
  await expect(sheet(page, 0)).toBeInViewport();
  await mkdir('tmp/qa', { recursive: true });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = 'tmp/qa/continuous-pages.pdf';
  await (await downloading).saveAs(path);
  const text = execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString().split('\f');
  expect(text[0]).toContain('Changed second page');
  expect(text[1]).toContain('Document page 1');
  expect((await PDFDocument.load(await readFile(path))).getPage(0).getWidth()).toBe(500);
  expect(errors).toEqual([]);
});

test('closely spaced lines remain clickable below an inline edit', async ({ page }) => {
  await open(page);
  await sheet(page, 0)
    .getByRole('button', { name: 'Edit: Close line 1 on page 1', exact: true })
    .click();
  const input = page.getByLabel('Edit text on page', { exact: true });
  await expect(input).toHaveValue('Close line 1 on page 1');
  const firstBounds = (await input.boundingBox())!;
  const second = sheet(page, 0).getByRole('button', {
    name: 'Edit: Close line 2 on page 1',
    exact: true,
  });
  const secondBounds = (await second.boundingBox())!;
  expect(firstBounds.y + firstBounds.height).toBeLessThan(secondBounds.y + 1);
  await second.click({ position: { x: 5, y: 2 } });
  await expect(input).toHaveValue('Close line 2 on page 1');
  await input.fill('Edited nearby line');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await sheet(page, 0)
    .getByRole('button', { name: 'Edit: Close line 3 on page 1', exact: true })
    .click({ position: { x: 5, y: 2 } });
  await expect(input).toHaveValue('Close line 3 on page 1');
  await page.screenshot({ path: 'tmp/qa/continuous-tight-selection.png' });
});

test('a single click edits the adjacent page while both pages are visible, and distant canvases unload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 18);
  await page.getByLabel('Canvas zoom', { exact: true }).selectOption('0.5');
  await page.getByRole('button', { name: 'Open page 1', exact: true }).click();
  await expect(
    sheet(page, 1).getByRole('button', { name: 'Edit: Document page 2', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('1');
  await sheet(page, 1).getByRole('button', { name: 'Edit: Document page 2', exact: true }).click();
  await expect(page.getByLabel('Edit text on page', { exact: true })).toHaveValue(
    'Document page 2',
  );
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('2');
  await align(page, 17);
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('18');
  await expect(sheet(page, 17).locator('canvas')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.locator('.editor-viewport canvas').count()).toBeLessThan(10);
  await expect(sheet(page, 0).locator('canvas')).toHaveCount(0);
});

test('opening inline controls keeps the clicked line in view at the bottom of a page', async ({
  page,
}) => {
  await open(page);
  const target = sheet(page, 0).getByRole('button', {
    name: 'Edit: Bottom of page 1',
    exact: true,
  });
  await target.scrollIntoViewIfNeeded();
  const before = (await target.boundingBox())!;
  await target.click();
  const input = page.getByLabel('Edit text on page', { exact: true });
  await expect(input).toHaveValue('Bottom of page 1');
  await expect(input).toBeInViewport();
  const after = (await input.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(50);
  await input.fill('Edited bottom line');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(input).toBeInViewport();
});

test.describe('touch scrolling', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('swiping the page crosses to the following PDF page', async ({ page }) => {
    await open(page);
    await page.getByLabel('Canvas zoom', { exact: true }).selectOption('page');
    const view = (await page.locator('.editor-viewport').boundingBox())!;
    const client = await page.context().newCDPSession(page);
    const x = view.x + view.width * 0.8;
    const bottom = Math.min(view.y + view.height - 35, 790);
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y: bottom }],
    });
    for (let step = 1; step <= 12; step++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: bottom - step * ((view.height * 0.8) / 12) }],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => Number(await page.getByLabel('Current page', { exact: true }).inputValue()))
      .toBeGreaterThan(1);
  });
});
