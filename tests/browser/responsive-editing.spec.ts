import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

test.beforeAll(() => mkdir('tmp/qa', { recursive: true }));

for (const [width, height] of [
  [1280, 720],
  [1440, 760],
  [1512, 850],
  [1920, 1080],
  [1024, 600],
]) {
  test(`sidebar keeps app links and footer visible at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'All Rovty apps' })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.sidebar-free')).toBeInViewport({ ratio: 1 });
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Organize pages' }).focus();
    await expect(nav.getByRole('link', { name: 'Organize pages' })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('.desktop-nav-toggle .lucide-panel-left-close')).toBeVisible();
    await page.screenshot({ path: `tmp/qa/sidebar-${width}-${height}.png` });
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('#product-navigation')).toBeHidden();
    await expect(page.locator('.desktop-nav-toggle .lucide-panel-left-open')).toBeVisible();
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(page.getByRole('link', { name: 'All Rovty apps' })).toBeInViewport({ ratio: 1 });
  });
}

test('mobile drawer keeps its footer reachable in portrait and landscape', async ({ page }) => {
  for (const [width, height] of [
    [390, 664],
    [700, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('link', { name: 'All Rovty apps' })).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.sidebar-free')).toBeInViewport({ ratio: 1 });
    const organize = page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Organize pages' });
    await organize.focus();
    await expect(organize).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `tmp/qa/sidebar-mobile-${width}-${height}.png` });
    await page.locator('.nav-scrim').click({ position: { x: width - 10, y: 150 } });
    await expect(page.locator('#product-navigation')).toBeHidden();
  }
});

test('continuous typing paints intermediate edits without blank frames or worker restarts', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const workers: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.setViewportSize({ width: 1280, height: 720 });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sheet = pdf.addPage([600, 800]);
  sheet.drawRectangle({ x: 0, y: 0, width: 600, height: 800, color: rgb(0.9, 0.95, 0.85) });
  sheet.drawText('Smooth editing', { x: 60, y: 690, size: 20, font });
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'smooth.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  const canvas = page.locator('.page-stage > canvas');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'Edit: Smooth editing', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await expect(input).toBeFocused();
  await expect(page.locator('.inline-cursor-layer')).toHaveAttribute('data-exact-layout', 'true');
  await input.press('ArrowRight');
  await expect(input).toBeFocused();
  const workerCount = workers.length;
  await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const metrics = {
      frames: 0,
      blank: 0,
      overlays: 0,
      changes: [] as number[],
      lastHash: 0,
      stopped: false,
      top: [] as number[],
    };
    (window as unknown as { typingMetrics: typeof metrics }).typingMetrics = metrics;
    function frame() {
      if (metrics.stopped) return;
      const context = canvas.getContext('2d')!;
      const [r, g, b, a] = context.getImageData(1, 1, 1, 1).data;
      if (a !== 255 || (r === 255 && g === 255 && b === 255)) metrics.blank++;
      if (document.querySelector('.page-stage > .page-loading')) metrics.overlays++;
      const scale = canvas.width / 600;
      const pixels = context.getImageData(
        Math.floor(50 * scale),
        Math.floor(85 * scale),
        Math.floor(500 * scale),
        Math.floor(35 * scale),
      ).data;
      let hash = 0;
      for (let i = 0; i < pixels.length; i += 4) hash = (hash * 31 + pixels[i]) | 0;
      if (hash !== metrics.lastHash) metrics.changes.push(performance.now());
      metrics.lastHash = hash;
      metrics.frames++;
      metrics.top.push(canvas.getBoundingClientRect().top);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  const suffix = ' with live text updates';
  for (const letter of suffix) {
    await page.keyboard.type(letter, { delay: 40 });
    await expect(input).toBeFocused();
  }
  const during = await page.evaluate(() => (window as any).typingMetrics.changes.length as number);
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(canvas).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.inline-cursor-layer')).toHaveAttribute('data-exact-layout', 'true');
  const metrics = await page.evaluate(() => {
    const metrics = (window as any).typingMetrics;
    metrics.stopped = true;
    return metrics as {
      frames: number;
      blank: number;
      overlays: number;
      changes: number[];
      top: number[];
    };
  });
  await testInfo.attach('typing-render-metrics', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
  await writeFile('tmp/qa/typing-render-metrics.json', JSON.stringify(metrics));
  expect(metrics.frames).toBeGreaterThan(5);
  expect(metrics.blank).toBe(0);
  expect(metrics.overlays).toBe(0);
  expect(during).toBeGreaterThan(3);
  expect(Math.max(...metrics.top) - Math.min(...metrics.top)).toBeLessThan(1);
  expect(workers.length).toBe(workerCount);
  await expect(input).toHaveValue('Smooth editing' + suffix);
  const caret = page.locator('.inline-text-caret');
  const beforeSpace = Number(await caret.getAttribute('x1'));
  await page.keyboard.type(' ');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.inline-cursor-layer')).toHaveAttribute('data-exact-layout', 'true');
  await expect
    .poll(async () => Number(await caret.getAttribute('x1')) - beforeSpace)
    .toBeCloseTo(5.56, 1);
  await expect(input).toBeFocused();
  await page.screenshot({ path: 'tmp/qa/smooth-inline-editing.png' });
  await input.press('Escape');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = 'tmp/qa/smooth-inline-editing.pdf';
  await (await download).saveAs(path);
  expect(execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString()).toContain(
    'Smooth editing' + suffix,
  );
  expect(errors).toEqual([]);
});
