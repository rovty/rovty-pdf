import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

test('tool entry loading budget', async ({ page, baseURL }) => {
  test.skip(!baseURL?.endsWith(':5181'), 'Measure the production build.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/edit');
  await expect(page.getByRole('button', { name: 'Choose a PDF', exact: true })).toBeEnabled();
  await page.waitForLoadState('networkidle');
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return { path: new URL(resource.name).pathname, bytes: resource.decodedBodySize };
    }),
  );
  await mkdir('tmp/qa', { recursive: true });
  await writeFile('tmp/qa/loading-after.json', JSON.stringify(resources, null, 2));
  expect(
    resources.filter((item) => /Workspace-|pdf.worker|pdfium|fontkit|\/pdfjs\//.test(item.path)),
  ).toEqual([]);
  expect(
    resources
      .filter((item) => item.path.endsWith('.js'))
      .reduce((sum, item) => sum + item.bytes, 0),
  ).toBeLessThan(400 * 1024);
  expect(errors).toEqual([]);
});

test('public HTML is reused when the application starts', async ({ page, baseURL }) => {
  test.skip(!baseURL?.endsWith(':5181'), 'Hydration uses the production HTML.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/index-*.js', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/edit', { waitUntil: 'commit' });
  await expect(page.locator('main h1')).toHaveText('Edit PDF');
  await page.evaluate(() => {
    (window as unknown as { originalMain: Element | null }).originalMain =
      document.querySelector('main');
  });
  release();
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { originalMain: Element | null }).originalMain ===
        document.querySelector('main'),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile drawer traps focus, closes with Escape and restores navigation focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
  await toggle.click();
  const close = page.getByRole('button', { name: 'Close navigation menu', exact: true });
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(page.getByRole('link', { name: 'All Rovty apps', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  await toggle.click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Merge PDF', exact: true })
    .click();
  await expect(page.locator('main')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Merge PDF', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/qa/optimized-upload-mobile.png', fullPage: true });
});

test('file selection survives a failed editor download with a safe reload action', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.endsWith(':5181'), 'Exercise a failed production chunk.');
  await page.route('**/assets/Workspace-*.js', (route) => route.abort());
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7'),
  });
  await expect(page.getByRole('alert')).toContainText('could not finish loading');
  await expect(page.getByRole('button', { name: 'Reload tool' })).toBeVisible();
  await page.unroute('**/assets/Workspace-*.js');
  await page.getByRole('button', { name: 'Reload tool' }).click();
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await expect(page.locator('.has-document')).toBeVisible();
});

test('tool links support new tabs and search finds format names', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search PDF tools' }).fill('jpg');
  await expect(page.locator('.tool-card')).toHaveCount(2);
  const next = context.waitForEvent('page');
  await page.locator('.tool-card[href="/images-to-pdf"]').click({ modifiers: ['ControlOrMeta'] });
  const tab = await next;
  await expect(tab).toHaveURL(/\/images-to-pdf$/);
  await expect(page).toHaveURL(/\/$/);
  await tab.close();
});

test('a failed cloud screen keeps the tool navigation usable', async ({ page, baseURL }) => {
  test.skip(!baseURL?.endsWith(':5181'), 'Exercise a failed production chunk.');
  await page.route('**/assets/CloudWorkspace-*.js', (route) => route.abort());
  await page.goto('/cloud');
  await expect(page.getByRole('alert')).toContainText('This view couldn’t open.');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'All tools', exact: true })
    .click();
  await expect(page.locator('.tool-card')).toHaveCount(23);
});

test('multiple files open together and a closed document can be replaced', async ({ page }) => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  const buffer = Buffer.from(await doc.save());
  await page.goto('/merge');
  await page.getByLabel('Choose PDF files').setInputFiles([
    { name: 'first.pdf', mimeType: 'application/pdf', buffer },
    { name: 'second.pdf', mimeType: 'application/pdf', buffer },
  ]);
  await expect(page.locator('.workspace-heading')).toContainText('2 pages');
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(page.locator('.has-document')).toHaveCount(0);
  await page
    .getByLabel('Choose PDF files')
    .setInputFiles({ name: 'replacement.pdf', mimeType: 'application/pdf', buffer });
  await expect(page.locator('.workspace-heading')).toContainText('replacement.pdf · 1 page');
});
