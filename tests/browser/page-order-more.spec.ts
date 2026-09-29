import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { revealPdfArea } from './canvas';

test('long thumbnail strips scroll during dragging, render lazily and ignore outside drops', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  const doc = await PDFDocument.create();
  for (let index = 0; index < 18; index++) doc.addPage([600, 800]);
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'long.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  const rail = page.locator('.editor-pages-rail');
  const first = page.getByRole('button', { name: 'Open page 1', exact: true });
  await first.scrollIntoViewIfNeeded();
  expect(await rail.locator('canvas').count()).toBeLessThan(18);
  let start = (await first.boundingBox())!,
    box = (await rail.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, start.y + 30, { steps: 8 });
  await expect
    .poll(() =>
      rail.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft),
    )
    .toBeLessThan(3);
  const last = (await page
    .getByRole('button', { name: 'Open page 18', exact: true })
    .boundingBox())!;
  await page.mouse.move(last.x + last.width / 2, last.y + 30, { steps: 4 });
  await expect(page.locator('.drop-after')).toHaveAttribute('data-editor-page', '17');
  await page.mouse.up();
  await expect(page.locator('[data-editor-page]').last()).toHaveAttribute('data-editor-page', '0');
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('18');
  await first.scrollIntoViewIfNeeded();
  start = (await first.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + 30);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-editor-page]').last()).toHaveAttribute('data-editor-page', '0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-editor-page]').first()).toHaveAttribute('data-editor-page', '0');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('reordered redactions remain burned into the correct page and preserve page dimensions', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([600, 800]).drawText('Private first page', { x: 60, y: 680, font, size: 24 });
  doc.addPage([400, 500]).drawText('Smaller second page', { x: 40, y: 400, font, size: 20 });
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'redaction-order.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Redact', exact: true }).click();
  await revealPdfArea(page, [40, 85], [310, 135]);
  const box = (await page.locator('.annotation-layer').boundingBox())!;
  await page.mouse.move(box.x + (40 / 600) * box.width, box.y + (85 / 800) * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + (310 / 600) * box.width, box.y + (135 / 800) * box.height, {
    steps: 6,
  });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Move page 1 later', exact: true }).click();
  await mkdir('tmp/qa', { recursive: true });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = 'tmp/qa/page-order-redacted.pdf';
  await (await pending).saveAs(path);
  const saved = await PDFDocument.load(await readFile(path));
  expect(saved.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
    [400, 500],
    [600, 800],
  ]);
  expect(execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString().trim()).toBe('');
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '2',
    '-singlefile',
    '-scale-to',
    '1000',
    '-png',
    path,
    'tmp/qa/page-order-redacted',
  ]);
});
