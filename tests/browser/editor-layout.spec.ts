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
  test(`header tools and focus view give the PDF room at ${width}×${height}`, async ({ page }) => {
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
    const heading = page.locator('.workspace-heading');
    const title = await heading.locator('h1').boundingBox();
    const actions = await heading.locator('.workspace-actions').boundingBox();
    await expect(heading.getByRole('toolbar')).toHaveCount(1);
    await expect(page.locator('.editor-body .editor-toolbar')).toHaveCount(0);
    await expect(heading.getByRole('toolbar')).toHaveAttribute('aria-orientation', 'horizontal');
    expect(tools!.y + tools!.height).toBeLessThanOrEqual(view!.y);
    if (width > 800) {
      expect(tools!.x).toBeGreaterThan(title!.x + title!.width);
      expect(tools!.x + tools!.width).toBeLessThanOrEqual(actions!.x);
    } else {
      expect(tools!.y).toBeGreaterThanOrEqual(actions!.y + actions!.height);
    }
    if (await page.locator('.editor-pages').count()) {
      const pages = await page.locator('.editor-pages').boundingBox();
      expect(pages!.x + pages!.width).toBeLessThanOrEqual(view!.x);
    }
    expect(view!.height).toBeGreaterThan(height * 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `tmp/qa/editor-header-${width}.png` });
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
  await page.keyboard.press('ArrowLeft');
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

for (const width of [1024, 390]) {
  test(`overflow tools stay reachable with pinned history at ${width}px`, async ({ page }) => {
    test.setTimeout(30000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/edit');
    await page.getByRole('button', { name: /Try a sample PDF/ }).click();
    const toolbar = page.getByRole('toolbar', { name: 'PDF editing tools' });
    const rail = toolbar.locator('.editor-tool-group');
    const more = toolbar.getByRole('button', { name: 'More tools', exact: true });
    await expect(more).toBeEnabled();
    await expect(toolbar.getByRole('button', { name: 'Previous tools' })).toBeDisabled();
    for (let clicks = 0; clicks < 20; clicks++) {
      const position = await rail.evaluate((element) => ({
        left: element.scrollLeft,
        remaining: element.scrollWidth - element.clientWidth - element.scrollLeft,
      }));
      if (position.remaining <= 1) break;
      await more.click();
      await expect
        .poll(() => rail.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(position.left);
    }
    await expect(more).toBeDisabled();
    const find = toolbar.getByRole('button', { name: 'Find & replace' });
    const toolBox = await find.boundingBox();
    const railBox = await rail.boundingBox();
    expect(toolBox!.x).toBeGreaterThanOrEqual(railBox!.x - 1);
    expect(toolBox!.x + toolBox!.width).toBeLessThanOrEqual(railBox!.x + railBox!.width + 1);
    await expect(toolbar.getByRole('button', { name: 'Undo', exact: true })).toBeInViewport();
    await find.click();
    await expect(page.getByRole('button', { name: 'Close find and replace' })).toBeVisible();
    // Arrow navigation brings an offscreen tool back into view without moving the canvas.
    await find.focus();
    await page.keyboard.press('Home');
    await expect(toolbar.getByRole('button', { name: 'Select', exact: true })).toBeFocused();
    await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect(toolbar.getByRole('button', { name: 'Previous tools' })).toBeDisabled();
  });
}
