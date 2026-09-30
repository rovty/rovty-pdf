import { test, expect, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

async function source() {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  for (const name of ['ALPHA', 'BETA']) {
    const page = doc.addPage([600, 800]);
    page.drawRectangle({ x: 40, y: 80, width: 240, height: 520, color: rgb(0.9, 0.08, 0.12) });
    page.drawRectangle({ x: 300, y: 80, width: 260, height: 520, color: rgb(0.05, 0.3, 0.9) });
    page.drawText(name, { x: 50, y: 700, size: 32, font });
  }
  return doc.save();
}
async function open(page: Page, tool: string) {
  await page.goto('/' + tool);
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'preview.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await source()),
  });
}
async function ready(page: Page) {
  await expect(page.locator('.live-tool-preview')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.live-preview-error')).toHaveCount(0);
  await expect(page.locator('.live-page-sheet canvas')).toHaveAttribute('data-ready', 'true');
}
async function pixels(page: Page) {
  await ready(page);
  return page.locator('.live-page-sheet canvas').evaluate((el) => {
    const canvas = el as HTMLCanvasElement,
      data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let colorful = 0,
      hash = 2166136261;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.max(data[index], data[index + 1], data[index + 2]) -
          Math.min(data[index], data[index + 1], data[index + 2]) >
        5
      )
        colorful++;
      hash = Math.imul(hash ^ data[index], 16777619);
      hash = Math.imul(hash ^ data[index + 1], 16777619);
      hash = Math.imul(hash ^ data[index + 2], 16777619);
    }
    return { colorful, hash, ratio: canvas.width / canvas.height };
  });
}
async function save(page: Page, action: string, name: string) {
  await mkdir('tmp/qa', { recursive: true });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: action, exact: true }).click();
  const path = `tmp/qa/${name}.pdf`;
  await (await pending).saveAs(path);
  return path;
}
function render(path: string, name: string, index = 1) {
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    String(index),
    '-singlefile',
    '-scale-to',
    '1000',
    '-png',
    path,
    `tmp/qa/${name}`,
  ]);
}

test('watermark controls preview current settings, preserve unaffected pages and recover from invalid input', async ({
  page,
}) => {
  const remote: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !/^https?:\/\/(127\.0\.0\.1|localhost):/.test(request.url())
    )
      remote.push(request.url());
  });
  await open(page, 'watermark');
  await ready(page);
  await page.getByLabel('Show original', { exact: true }).check();
  const original = await pixels(page);
  await page.getByLabel('Show original', { exact: true }).uncheck();
  await page.getByLabel('Pages', { exact: true }).fill('2');
  await page.getByLabel('Watermark text', { exact: true }).fill('DRAFT');
  await page.getByLabel('Watermark text', { exact: true }).fill('LATEST REVIEW');
  await page.getByLabel('Font size', { exact: true }).fill('28');
  await page.getByLabel('Position', { exact: true }).selectOption('center');
  await page.getByLabel('Text color', { exact: true }).fill('#00aa00');
  await page.getByRole('slider', { name: 'Opacity', exact: true }).press('End');
  expect((await pixels(page)).hash).toBe(original.hash);
  await page.getByRole('button', { name: 'Next preview page', exact: true }).click();
  const watermark = await pixels(page);
  await page.getByLabel('Show original', { exact: true }).check();
  expect((await pixels(page)).hash).not.toBe(watermark.hash);
  await page.getByLabel('Show original', { exact: true }).uncheck();
  await page.getByLabel('Pages', { exact: true }).fill('9');
  await expect(page.locator('.live-preview-error')).toBeVisible();
  await expect(page.locator('.live-page-sheet')).toHaveCount(0);
  await page.getByLabel('Pages', { exact: true }).fill('2');
  await ready(page);
  const path = await save(page, 'Add watermark', 'live-watermark');
  const text = execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString().split('\f');
  expect(text[0]).not.toContain('LATEST REVIEW');
  expect(text[1]).toContain('LATEST REVIEW');
  expect(text.join('')).not.toContain('DRAFT');
  render(path, 'live-watermark-export', 2);
  await page.screenshot({ path: 'tmp/qa/live-watermark-desktop.png', fullPage: true });
  expect(remote).toEqual([]);
});

test('grayscale and image quality render into the page preview rather than showing the original', async ({
  page,
}) => {
  await open(page, 'grayscale');
  expect((await pixels(page)).colorful).toBe(0);
  await page.getByLabel('Show original', { exact: true }).check();
  expect((await pixels(page)).colorful).toBeGreaterThan(10000);
  await page.getByLabel('Show original', { exact: true }).uncheck();
  await page.getByLabel('Resolution', { exact: true }).selectOption('72');
  await page.getByRole('slider', { name: 'Image quality', exact: true }).press('Home');
  const low = await pixels(page);
  await page.getByRole('slider', { name: 'Image quality', exact: true }).press('End');
  const high = await pixels(page);
  expect(high.hash).not.toBe(low.hash);
  expect(high.colorful).toBe(0);
  const path = await save(page, 'Convert to grayscale', 'live-grayscale');
  expect(execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString().trim()).toBe('');
  render(path, 'live-grayscale-export');
  await page.screenshot({ path: 'tmp/qa/live-grayscale-desktop.png', fullPage: true });
});

test('crop and numbering previews use the same page selection and geometry as export', async ({
  page,
}) => {
  await open(page, 'crop');
  await page.getByLabel('Pages', { exact: true }).fill('2');
  await page.getByLabel('Margin (points)', { exact: true }).fill('60');
  expect((await pixels(page)).ratio).toBeCloseTo(600 / 800, 2);
  await page.getByRole('button', { name: 'Next preview page', exact: true }).click();
  expect((await pixels(page)).ratio).toBeCloseTo(480 / 680, 2);
  let path = await save(page, 'Crop pages', 'live-crop');
  const cropped = await PDFDocument.load(await readFile(path));
  expect(cropped.getPage(1).getCropBox()).toEqual({ x: 60, y: 60, width: 480, height: 680 });
  await open(page, 'page-numbers');
  await page.getByLabel('Pages', { exact: true }).fill('2,1');
  await page.getByLabel('Start numbering at', { exact: true }).fill('7');
  await page.getByLabel('Position', { exact: true }).selectOption('top');
  const numbered = await pixels(page);
  await page.getByLabel('Show original', { exact: true }).check();
  expect((await pixels(page)).hash).not.toBe(numbered.hash);
  path = await save(page, 'Add page numbers', 'live-numbers');
  const text = execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString().split('\f');
  expect(text[0]).toMatch(/\b8\b/);
  expect(text[1]).toMatch(/\b7\b/);
});

test('range and split settings immediately show the selected output pages and groups', async ({
  page,
}) => {
  await open(page, 'extract');
  await page.getByLabel('Pages', { exact: true }).fill('2,1');
  await expect(page.locator('.page-filename')).toHaveText(['Page 2', 'Page 1']);
  await page.getByLabel('Pages', { exact: true }).fill('2');
  await expect(page.locator('.page-tile')).toHaveCount(1);
  await open(page, 'delete');
  await page.getByLabel('Pages to remove', { exact: true }).fill('1');
  await expect(page.locator('.page-filename')).toHaveText(['Page 2']);
  await open(page, 'split');
  await page.getByLabel('Split by', { exact: true }).selectOption('every');
  await page.getByLabel('Pages per PDF', { exact: true }).fill('2');
  await expect(page.locator('.split-preview-group')).toHaveText(['PDF 1', 'PDF 1']);
  await page.getByLabel('Split by', { exact: true }).selectOption('ranges');
  await page.getByLabel('Separate ranges', { exact: true }).fill('2,1');
  await expect(page.locator('.page-filename')).toHaveText(['Page 2', 'Page 1']);
  await expect(page.locator('.split-preview-group')).toHaveText(['PDF 1', 'PDF 2']);
});

test('mobile image layout previews paper size, orientation and margins before downloading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/images-to-pdf');
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 400;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#aa2255';
    ctx.fillRect(0, 0, 800, 400);
    return c.toDataURL().split(',')[1];
  });
  await page.getByLabel('Choose images', { exact: true }).setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByLabel('Page size', { exact: true }).selectOption('letter');
  await page.getByLabel('Orientation', { exact: true }).selectOption('landscape');
  await page.getByLabel('Margin (points)', { exact: true }).fill('36');
  const preview = page.locator('.live-page-sheet .image-pdf-preview');
  await expect(preview).toHaveAttribute('data-ready', 'true');
  const layout = await preview.evaluate((el) => {
    const box = el.getBoundingClientRect(),
      image = el.querySelector('img')!.getBoundingClientRect();
    return { ratio: box.width / box.height, margin: (image.left - box.left) / box.width };
  });
  expect(layout.ratio).toBeCloseTo(792 / 612, 2);
  expect(layout.margin).toBeCloseTo(36 / 792, 2);
  const path = await save(page, 'Create PDF', 'live-images');
  const doc = await PDFDocument.load(await readFile(path));
  expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 });
  await expect(page.locator('.live-tool-preview')).toHaveAttribute('aria-busy', 'false');
  await page.screenshot({ path: 'tmp/qa/live-images-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('image export and compression previews follow format, resolution and quality settings', async ({
  page,
}) => {
  await open(page, 'pdf-to-images');
  await page.getByLabel('Pages', { exact: true }).fill('2');
  await page.getByLabel('Resolution', { exact: true }).selectOption('72');
  await page.getByRole('slider', { name: 'Image quality', exact: true }).press('Home');
  const jpg = await pixels(page);
  await page.getByLabel('Image format', { exact: true }).selectOption('png');
  const png = await pixels(page);
  expect(png.hash).not.toBe(jpg.hash);
  await expect(page.getByLabel('Preview page', { exact: true })).toHaveAttribute('max', '1');
  await expect(page.locator('.page-filename')).toHaveText(['Page 2']);
  await open(page, 'compress');
  await page.getByRole('slider', { name: 'Image quality', exact: true }).press('Home');
  const low = await pixels(page);
  await page.getByRole('slider', { name: 'Image quality', exact: true }).press('End');
  expect((await pixels(page)).hash).not.toBe(low.hash);
  await expect(page.locator('.live-preview-status')).toContainText('keeps your original');
});

test('editor page thumbnails show annotation drafts, property changes and undo', async ({
  page,
}) => {
  await open(page, 'edit');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await page
    .locator('.page-stage[data-active=true] .annotation-layer')
    .boundingBox())!;
  await page.mouse.move(box.x + (60 / 600) * box.width, box.y + (60 / 800) * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + (200 / 600) * box.width, box.y + (100 / 800) * box.height, {
    steps: 5,
  });
  const thumb = page.locator('[data-editor-page="0"] .editor-thumbnail-marks rect');
  await expect(thumb).toHaveCount(1);
  await page.mouse.up();
  await page.getByRole('checkbox', { name: 'Fill shape', exact: true }).check();
  await page.getByLabel('Fill color', { exact: true }).fill('#ff0000');
  await page.getByRole('button', { name: 'Open page 1', exact: true }).scrollIntoViewIfNeeded();
  await expect(thumb).toHaveAttribute('fill', '#ff0000');
  await page.screenshot({ path: 'tmp/qa/live-editor-thumbnails.png', fullPage: true });
  for (let index = 0; index < 3; index++)
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(thumb).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
