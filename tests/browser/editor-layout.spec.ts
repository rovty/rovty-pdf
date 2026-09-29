import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test.beforeAll(() => mkdir('tmp/qa', { recursive: true }));
for (const [width, height] of [
  [1280, 720],
  [1440, 900],
  [1024, 600],
  [390, 844],
]) {
  test(`side tools and focus view give the PDF room at ${width}×${height}`, async ({ page }) => {
    test.setTimeout(45000);
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto('/edit');
    await page.getByRole('button', { name: /Try a sample PDF/ }).click();
    await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
    const tools = await page.getByRole('toolbar', { name: 'PDF editing tools' }).boundingBox();
    const view = await page.locator('.editor-viewport').boundingBox();
    expect(tools!.x + tools!.width).toBeLessThanOrEqual(view!.x);
    expect(view!.height).toBeGreaterThan(height * 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `tmp/qa/editor-side-${width}.png` });
    await page.getByRole('button', { name: 'Focus view', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit focus view' })).toBeVisible();
    await expect(page.locator('.editor-inspector')).toBeHidden();
    await expect(page.locator('.editor-pages')).toHaveCount(0);
    await expect(page.getByLabel('Canvas zoom', { exact: true })).toHaveValue('page');
    await expect(page.locator('.page-stage > canvas')).toHaveAttribute('data-ready', 'true');
    const focused = await page.locator('.editor-viewport').boundingBox();
    expect(focused!.height).toBeGreaterThan(height * 0.7);
    await expect(page.locator('.page-stage')).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeInViewport();
    await page.screenshot({ path: `tmp/qa/editor-focus-${width}.png` });
    await page.getByRole('button', { name: 'Tool settings', exact: true }).click();
    await expect(page.locator('.editor-inspector')).toBeVisible();
    await page.getByRole('button', { name: 'Close tool settings' }).click();
    await page.getByRole('button', { name: 'Page thumbnails', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Page order' })).toBeVisible();
    await page.getByRole('button', { name: 'Close page thumbnails' }).click();
    await page.getByRole('button', { name: 'Edit: A small idea.', exact: true }).click();
    await page.getByLabel('Edit text on page', { exact: true }).fill('A bigger view.');
    await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('button', { name: 'Finish editing text', exact: true }).click();
    await page.getByRole('button', { name: 'Exit focus view' }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Focus view', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    await expect(page.getByLabel('Canvas zoom', { exact: true })).toHaveValue('width');
    await page.locator('.annotation-hit').first().click();
    await expect(page.getByLabel('Edit text on page', { exact: true })).toHaveValue(
      'A bigger view.',
    );
    expect(errors).toEqual([]);
  });
}

test('focus view keeps dialogs, tool keyboard navigation and download available', async ({
  page,
}) => {
  await page.goto('/edit');
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await page.getByRole('button', { name: 'Focus view', exact: true }).click();
  expect(await page.locator('.topbar').evaluate((element) => (element as HTMLElement).inert)).toBe(
    true,
  );
  const toolbar = page.getByRole('toolbar', { name: 'PDF editing tools' });
  await toolbar.getByRole('button', { name: 'Add text', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(toolbar.getByRole('button', { name: 'Edit text', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Signature', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exit focus view' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const download = await pending;
  await download.saveAs('tmp/qa/focus-view-export.pdf');
  expect(
    (await PDFDocument.load(await readFile('tmp/qa/focus-view-export.pdf'))).getPageCount(),
  ).toBe(3);
  await page.getByRole('button', { name: 'Exit focus view' }).click();
  expect(await page.locator('.topbar').evaluate((element) => (element as HTMLElement).inert)).toBe(
    false,
  );
});
