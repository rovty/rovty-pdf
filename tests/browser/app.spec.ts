import { test, expect, type Page } from '@playwright/test';
import { revealPdfArea } from './canvas';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PDFDocument, degrees, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { unzipSync } from 'fflate';

const qa = 'tmp/qa';
test.beforeAll(async () => {
  await mkdir(qa, { recursive: true });
});
const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const found: string[] = [];
  issues.set(page, found);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    )
      found.push(`External request: ${url.href}`);
  });
  page.on('pageerror', (error) => found.push(error.message));
  await page.exposeFunction('recordCspViolation', (directive: string) =>
    found.push(`CSP: ${directive}`),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void (
        window as unknown as { recordCspViolation: (value: string) => Promise<void> }
      ).recordCspViolation(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
});
test.afterEach(async ({ page }) => {
  expect(issues.get(page)).toEqual([]);
});
async function sample(page: Page, tool: string) {
  await page.goto('/' + tool);
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await expect(page.locator('.has-document')).toBeVisible();
  await expect(page.locator('.error-banner')).toHaveCount(0);
}
async function save(page: Page, label: string, name: string) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const download = await waiting;
  const path = `${qa}/${name}`;
  await download.saveAs(path);
  await expect(page.getByText('Your file is ready.', { exact: true })).toBeVisible();
  return path;
}
const text = (path: string) => execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString();
async function dragOnPage(page: Page, from: number[], to: number[]) {
  await revealPdfArea(page, from, to);
  const svg = page.locator('.annotation-layer'),
    box = (await svg.boundingBox())!;
  const dimensions = await svg.getAttribute('viewBox');
  const [, , w, h] = dimensions!.split(' ').map(Number);
  await page.mouse.move(box.x + (from[0] / w) * box.width, box.y + (from[1] / h) * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + (to[0] / w) * box.width, box.y + (to[1] / h) * box.height, {
    steps: 12,
  });
  await page.mouse.up();
}

test('tool library is responsive, searchable and private', async ({ page }) => {
  const remote: string[] = [];
  page.on('request', (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) remote.push(r.url());
  });
  const response = await page.goto('/');
  if (page.url().includes(':5181')) {
    expect(response?.headers()['content-security-policy']).toContain(
      "script-src 'self' 'wasm-unsafe-eval'",
    );
  }
  await expect(page.getByRole('heading', { name: 'A little less paperwork.' })).toBeVisible();
  await expect(page.locator('.tool-card')).toHaveCount(23);
  await page.screenshot({ path: `${qa}/home-desktop.png`, fullPage: true });
  await page.getByRole('searchbox', { name: 'Search PDF tools' }).fill('merge');
  await expect(page.locator('.tool-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${qa}/home-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Edit PDF', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Edit PDF', exact: true })).toBeVisible();
  expect(remote).toEqual([]);
});

test('existing text is truly replaced and additions export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sample(page, 'edit');
  await page.locator('.native-text-target').filter({ hasText: 'A small idea.' }).click();
  await page
    .getByRole('textbox', { name: 'Edit text on page', exact: true })
    .fill('A better idea.');
  await page.getByRole('button', { name: 'Add text', exact: true }).first().click();
  await dragOnPage(page, [70, 430], [70, 430]);
  await page
    .getByRole('textbox', { name: 'Edit text on page', exact: true })
    .fill('Added in Rovty PDF');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await page.screenshot({ path: `${qa}/editor.png`, fullPage: true });
  const path = await save(page, 'Download PDF', 'edited.pdf');
  const extracted = text(path);
  expect(extracted).toContain('A better idea.');
  expect(extracted).toContain('Added in Rovty PDF');
  expect(extracted).not.toContain('A small idea.');
  expect(errors).toEqual([]);
});

test('separate letters select as one related line and export with the original font', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const original = 'Edit these letters together.';
  const replacement = 'This whole line is edited.';
  const untouched = 'The next line stays separate.';
  for (let index = 0; index < 2; index++) {
    const sheet = doc.addPage([600, 800]);
    const drawLetters = (text: string, y: number) => {
      let x = 60;
      for (const char of text) {
        if (char !== ' ') sheet.drawText(char, { x, y, font, size: 18 });
        x += font.widthOfTextAtSize(char, 18);
      }
    };
    if (index === 0) drawLetters(original, 680);
    else sheet.drawText(replacement, { x: 60, y: 680, font, size: 18 });
    drawLetters(untouched, 654);
    sheet.drawText('Separate column.', { x: 395, y: 680, font, size: 18 });
  }
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'fragmented-lines.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.native-text-target')).toHaveCount(3);
  await page.getByRole('button', { name: `Edit: ${original}`, exact: true }).press('Enter');
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await expect(input).toHaveValue(original);
  await input.fill(replacement);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(input).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(input).toHaveValue(replacement);
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await expect(page.locator('.text-edit-error')).toHaveCount(0);
  await page.screenshot({ path: `${qa}/line-selection-editor.png`, fullPage: true });
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(page.locator('.native-text-target')).toHaveCount(2);
  await expect(page.getByRole('button', { name: `Edit: ${untouched}`, exact: true })).toBeVisible();
  const path = await save(page, 'Download PDF', 'line-selection.pdf');
  expect(text(path)).toContain(replacement);
  expect(text(path)).toContain(untouched);
  expect(text(path)).not.toContain(original);
  execFileSync('/opt/homebrew/bin/pdftoppm', ['-r', '110', '-png', path, `${qa}/line-selection`]);
  expect(await readFile(`${qa}/line-selection-1.png`)).toEqual(
    await readFile(`${qa}/line-selection-2.png`),
  );
});

test('edited text matches the original fonts and baseline pixel for pixel after download', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = [
    await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    await doc.embedFont(StandardFonts.HelveticaBold),
    await doc.embedFont(StandardFonts.CourierOblique),
    await doc.embedFont(await readFile('public/fonts/NotoSans-Regular.ttf')),
  ];
  const labels = ['Serif', 'Sans', 'Mono', 'Embedded'];
  for (let i = 0; i < 2; i++) {
    const sheet = doc.addPage([600, 800]);
    sheet.setCropBox(30, 40, 540, 720);
    sheet.setRotation(degrees(90));
    fonts.forEach((font, index) =>
      sheet.drawText(`${labels[index]} ${i ? 'matched' : 'original'}.`, {
        font,
        size: 20,
        x: 75,
        y: 650 - index * 100,
        color: rgb(0.15, 0.2, 0.35),
      }),
    );
  }
  const fixture = await doc.save();
  await writeFile(`${qa}/font-matching-original.pdf`, fixture);
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'font-matching.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(fixture),
  });
  for (const label of labels) {
    await page.getByRole('button', { name: 'Edit text', exact: true }).click();
    await page.getByRole('button', { name: `Edit: ${label} original.`, exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
      'original',
    );
    await expect(page.getByTestId('matched-font')).toContainText('baseline');
    await page
      .getByRole('textbox', { name: 'Edit text on page', exact: true })
      .fill(`${label} matched.`);
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.text-edit-error')).toHaveCount(0);
  await expect(page.locator('.annotation text')).toHaveCount(0);
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await page.screenshot({ path: `${qa}/font-matching-editor.png`, fullPage: true });
  const path = await save(page, 'Download PDF', 'font-matching.pdf');
  expect(text(path)).not.toContain('original.');
  execFileSync('/opt/homebrew/bin/pdftoppm', ['-r', '110', '-png', path, `${qa}/font-matching`]);
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '2',
    '-singlefile',
    '-r',
    '110',
    '-png',
    `${qa}/font-matching-original.pdf`,
    `${qa}/font-matching-reference`,
  ]);
  expect(await readFile(`${qa}/font-matching-1.png`)).toEqual(
    await readFile(`${qa}/font-matching-reference.png`),
  );
});

test('missing subset glyphs show a recoverable error and never silently change font', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await readFile('public/fonts/NotoSans-Regular.ttf'), {
    subset: true,
  });
  doc.addPage([600, 800]).drawText('ABBA', { font, size: 24, x: 80, y: 650 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'subset.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await page.getByRole('button', { name: 'Edit: ABBA', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit text on page', exact: true }).fill('ZEBRA');
  await expect(page.locator('.text-edit-error')).toContainText(
    'does not contain all the characters',
  );
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'original',
  );
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await expect(page.locator('.error-banner')).toContainText('does not contain all the characters');
  await page.screenshot({ path: `${qa}/font-matching-error-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'Text font', exact: true }).selectOption('noto');
  await expect(page.locator('.text-edit-error')).toHaveCount(0);
  const path = await save(page, 'Download PDF', 'font-fallback.pdf');
  expect(text(path)).toContain('ZEBRA');
  expect(text(path)).not.toContain('ABBA');
});

test('form fields and drawn signatures survive download', async ({ page }) => {
  await sample(page, 'fill');
  await page.getByLabel('Your name', { exact: true }).fill('Taylor Jordan');
  await page.getByLabel('Approved', { exact: true }).check();
  let path = await save(page, 'Download filled PDF', 'filled.pdf');
  let doc = await PDFDocument.load(await readFile(path));
  expect(doc.getForm().getTextField('Your name').getText()).toBe('Taylor Jordan');
  expect(doc.getForm().getCheckBox('Approved').isChecked()).toBe(true);
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  const canvas = page.getByLabel('Draw your signature'),
    box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 30, { steps: 4 });
  await page.mouse.move(box.x + 150, box.y + 110, { steps: 4 });
  await page.mouse.move(box.x + 260, box.y + 80, { steps: 4 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Use signature' }).click();
  path = await save(page, 'Download filled PDF', 'signed.pdf');
  expect(execFileSync('/opt/homebrew/bin/pdfimages', ['-list', path]).toString()).toContain(
    'image',
  );
});

test('page organization and rotation produce the requested pages', async ({ page }) => {
  await sample(page, 'organize');
  await page.getByRole('button', { name: 'Move page 3 earlier', exact: true }).click();
  await page.getByRole('button', { name: 'Rotate page 1', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Remove page 4', exact: true }).click();
  const path = await save(page, 'Save page order', 'organized.pdf');
  const doc = await PDFDocument.load(await readFile(path));
  expect(doc.getPageCount()).toBe(3);
  expect(doc.getPage(0).getRotation().angle).toBe(90);
  expect(text(path)).toContain('Ready when you are.');
  expect(text(path)).not.toContain('Room to make it yours.');
});

test('password protection and unlocking work without remote requests', async ({ page }) => {
  await sample(page, 'protect');
  await page.getByLabel('Password to open the PDF').fill('Rovty-test-password-2026');
  const path = await save(page, 'Protect PDF', 'protected.pdf');
  expect(
    execFileSync('/opt/homebrew/bin/pdfinfo', [
      '-upw',
      'Rovty-test-password-2026',
      path,
    ]).toString(),
  ).toMatch(/Encrypted:\s+yes/);
  await page.goto('/unlock');
  await page.getByLabel('Choose PDF files', { exact: true }).setInputFiles(path);
  await page.getByLabel('PDF password', { exact: true }).fill('Rovty-test-password-2026');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('.has-document')).toBeVisible();
  const unlocked = await save(page, 'Save unlocked PDF', 'unlocked.pdf');
  expect(text(unlocked)).toContain('A small idea.');
  expect(execFileSync('/opt/homebrew/bin/pdfinfo', [unlocked]).toString()).toMatch(
    /Encrypted:\s+no/,
  );
});

test('redactions discard original text and burn covered pixels into images', async ({ page }) => {
  await sample(page, 'redact');
  await dragOnPage(page, [40, 115], [410, 180]);
  await expect(page.getByRole('heading', { name: 'Redact', exact: true })).toBeVisible();
  const path = await save(page, 'Apply redactions', 'redacted.pdf');
  expect(text(path).trim()).toBe('');
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '1',
    '-singlefile',
    '-scale-to',
    '1000',
    '-png',
    path,
    `${qa}/redacted-page`,
  ]);
});

for (const item of [
  ['merge', 'Merge files', 'merged.pdf'],
  ['split', 'Split PDF', 'split.zip'],
  ['extract', 'Extract pages', 'extracted.pdf'],
  ['delete', 'Delete selected pages', 'deleted.pdf'],
  ['rotate', 'Save rotations', 'rotated.pdf'],
  ['compress', 'Compress PDF', 'compressed.pdf'],
  ['pdf-to-images', 'Export images', 'images.zip'],
  ['text', 'Extract text', 'text.txt'],
  ['watermark', 'Add watermark', 'watermark.pdf'],
  ['page-numbers', 'Add page numbers', 'numbered.pdf'],
  ['crop', 'Crop pages', 'cropped.pdf'],
  ['grayscale', 'Convert to grayscale', 'grayscale.pdf'],
  ['flatten', 'Flatten forms', 'flattened.pdf'],
  ['metadata', 'Save metadata', 'metadata.pdf'],
  ['repair', 'Rebuild PDF', 'repaired.pdf'],
])
  test(`working export: ${item[0]}`, async ({ page }) => {
    await sample(page, item[0]);
    if (item[0] === 'delete') await page.getByLabel('Pages to remove', { exact: true }).fill('2');
    if (item[0] === 'extract') await page.getByLabel('Pages', { exact: true }).fill('2-3');
    const path = await save(page, item[1], item[2]),
      bytes = await readFile(path);
    expect(bytes.length).toBeGreaterThan(50);
    if (item[2].endsWith('.zip')) expect(Object.keys(unzipSync(bytes))).toHaveLength(3);
    else if (item[2].endsWith('.pdf')) {
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(['delete', 'extract'].includes(item[0]) ? 2 : 3);
      if (item[0] === 'crop') expect(doc.getPage(0).getCropBox().width).toBeCloseTo(555.28, 1);
      if (item[0] === 'flatten') expect(doc.getForm().getFields()).toHaveLength(0);
      if (item[0] === 'watermark') expect(text(path)).toContain('CONFIDENTIAL');
    }
  });

test('images become a PDF and bad uploads show a recoverable error', async ({ page }) => {
  await page.goto('/images-to-pdf');
  const image = await page.screenshot();
  await page
    .getByLabel('Choose images', { exact: true })
    .setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: image });
  const path = await save(page, 'Create PDF', 'from-images.pdf');
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1);
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files', { exact: true }).setInputFiles({
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('Not a PDF'),
  });
  await expect(page.getByRole('alert')).toContainText('could not be read as a PDF');
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await expect(page.locator('.has-document')).toBeVisible();
});

test('mobile editor supports keyboard text selection and downloading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sample(page, 'edit');
  const target = page.getByRole('button', { name: 'Edit: A small idea.', exact: true });
  await target.focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('textbox', { name: 'Edit text on page', exact: true })
    .fill('Edited on mobile.');
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await page.screenshot({ path: `${qa}/editor-mobile.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const path = await save(page, 'Download PDF', 'mobile-edited.pdf');
  expect(text(path)).toContain('Edited on mobile.');
  expect(text(path)).not.toContain('A small idea.');
});

test('annotations align on a rotated cropped PDF', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([600, 800]);
  sheet.setCropBox(50, 100, 500, 600);
  sheet.setRotation(degrees(90));
  sheet.drawText('Original rotated page', { x: 100, y: 300, size: 16, font });
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files', { exact: true }).setInputFiles({
    name: 'rotated-cropped.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.has-document')).toBeVisible();
  await page.getByRole('button', { name: 'Add text', exact: true }).first().click();
  await dragOnPage(page, [80, 70], [80, 70]);
  await page.getByRole('textbox', { name: 'Edit text on page', exact: true }).fill('Placed here.');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await dragOnPage(page, [60, 50], [250, 130]);
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await page.screenshot({ path: `${qa}/rotated-editor.png`, fullPage: true });
  const path = await save(page, 'Download PDF', 'rotated-edited.pdf');
  expect(text(path)).toContain('Placed here.');
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-cropbox',
    '-f',
    '1',
    '-singlefile',
    '-scale-to',
    '1000',
    '-png',
    path,
    `${qa}/rotated-edited-page`,
  ]);
});

test('closing a protected document clears the password option', async ({ page }) => {
  await sample(page, 'protect');
  await page.getByLabel('Password to open the PDF').fill('Never-retain-me');
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await expect(page.locator('.has-document')).toBeVisible();
  await expect(page.getByLabel('Password to open the PDF')).toHaveValue('');
});

async function signatureFixture(page: Page, transparent = false) {
  const data = await page.evaluate((transparent) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 220;
    const context = canvas.getContext('2d')!;
    if (!transparent) {
      context.fillStyle = '#f8f4e6';
      context.fillRect(0, 0, 600, 220);
    }
    context.strokeStyle = '#193c83';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(85, 155);
    context.bezierCurveTo(115, 105, 145, 30, 159, 55);
    context.bezierCurveTo(173, 80, 138, 155, 131, 160);
    context.moveTo(100, 130);
    context.lineTo(175, 115);
    context.bezierCurveTo(230, 175, 210, 30, 236, 57);
    context.bezierCurveTo(258, 92, 198, 162, 259, 140);
    context.bezierCurveTo(308, 109, 272, 99, 274, 131);
    context.bezierCurveTo(278, 173, 325, 121, 345, 103);
    context.moveTo(333, 100);
    context.lineTo(363, 144);
    context.moveTo(80, 181);
    context.bezierCurveTo(213, 153, 369, 168, 490, 126);
    context.stroke();
    return canvas.toDataURL(transparent ? 'image/png' : 'image/jpeg', 0.96);
  }, transparent);
  return Buffer.from(data.split(',')[1], 'base64');
}
async function transparentFraction(page: Page) {
  return page.getByAltText('Signature preview', { exact: true }).evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] === 0) transparent++;
    return transparent / (pixels.length / 4);
  });
}

test('uploaded signatures remove paper backgrounds and export transparency', async ({ page }) => {
  const doc = await PDFDocument.create(),
    sheet = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sheet.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(0.9, 0.94, 0.85) });
  sheet.drawText('Signature on a colored document', { x: 60, y: 740, size: 22, font });
  sheet.drawLine({ start: { x: 160, y: 360 }, end: { x: 440, y: 360 }, thickness: 1 });
  sheet.drawText('Approved by', { x: 160, y: 335, size: 12, font });
  await page.goto('/sign');
  await page.getByLabel('Choose PDF files', { exact: true }).setInputFiles({
    name: 'approval.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  });
  await expect(page.locator('.has-document')).toBeVisible();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Upload image', exact: true }).click();
  const upload = page.getByLabel('Upload signature image', { exact: true });
  await upload.setInputFiles({
    name: 'invalid.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(page.getByRole('alert')).toContainText('Choose a PNG, JPG or WebP');
  await upload.setInputFiles({
    name: 'my-signature.jpg',
    mimeType: 'image/jpeg',
    buffer: await signatureFixture(page),
  });
  await expect(page.getByRole('button', { name: 'Use signature', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Remove background', { exact: true })).toBeChecked();
  expect(await transparentFraction(page)).toBeGreaterThan(0.7);
  await page.getByLabel('Remove background', { exact: true }).uncheck();
  await expect(page.locator('.signature-preview')).toHaveAttribute('aria-busy', 'false');
  expect(await transparentFraction(page)).toBeLessThan(0.15);
  await page.getByLabel('Remove background', { exact: true }).check();
  await page.getByRole('slider', { name: /Background removal strength/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.signature-preview')).toHaveAttribute('aria-busy', 'false');
  await page.screenshot({ path: `${qa}/signature-upload.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const path = await save(page, 'Download signed PDF', 'signature-uploaded.pdf');
  expect(execFileSync('/opt/homebrew/bin/pdfimages', ['-list', path]).toString()).toContain(
    'smask',
  );
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '1',
    '-singlefile',
    '-scale-to',
    '1000',
    '-png',
    path,
    `${qa}/signature-uploaded-page`,
  ]);
});

test('transparent signature uploads are preserved on mobile and empty paper is recoverable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await sample(page, 'sign');
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Upload image', exact: true }).click();
  const upload = page.getByLabel('Upload signature image', { exact: true });
  const blank = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 100, 100);
    return canvas.toDataURL();
  });
  await upload.setInputFiles({
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blank.split(',')[1], 'base64'),
  });
  await expect(page.getByRole('alert')).toContainText('No signature is visible');
  await expect(page.getByRole('button', { name: 'Use signature', exact: true })).toBeDisabled();
  await upload.setInputFiles({
    name: 'transparent.png',
    mimeType: 'image/png',
    buffer: await signatureFixture(page, true),
  });
  await expect(page.getByRole('button', { name: 'Use signature', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Remove background', { exact: true })).not.toBeChecked();
  expect(await transparentFraction(page)).toBeGreaterThan(0.7);
  expect(
    await page
      .getByRole('dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: `${qa}/signature-upload-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
  await expect(page.locator('.annotation image')).toHaveCount(1);
});

async function uploadSavedSignature(page: Page, name = 'Alex signature') {
  await sample(page, 'sign');
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Upload image', exact: true }).click();
  await page.getByLabel('Upload signature image', { exact: true }).setInputFiles({
    name: 'signature.jpg',
    mimeType: 'image/jpeg',
    buffer: await signatureFixture(page),
  });
  await expect(page.getByRole('button', { name: 'Use signature', exact: true })).toBeEnabled();
  await page.getByLabel('Save on this device', { exact: true }).check();
  await page.getByLabel('Signature name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
}

test('saved signatures survive reload, stay out of cookies, and can be reused or deleted', async ({
  page,
  context,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await uploadSavedSignature(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.has-document')).toHaveCount(0);
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: /Saved signatures/ }).click();
  await page.getByRole('button', { name: 'Select Alex signature', exact: true }).click();
  await page.screenshot({ path: `${qa}/saved-signatures.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Use signature', exact: true })).toBeInViewport();
  await page.screenshot({ path: `${qa}/saved-signatures-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
  const output = await save(page, 'Download signed PDF', 'reused-signature.pdf');
  expect(execFileSync('/opt/homebrew/bin/pdfimages', ['-list', output]).toString()).toContain(
    'smask',
  );
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: /Saved signatures/ }).click();
  await page.getByRole('button', { name: 'Delete Alex signature', exact: true }).click();
  await expect(page.getByText('No saved signatures yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Close signature dialog' }).click();
  await page.reload();
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: /Saved signatures/ }).click();
  await expect(page.getByRole('button', { name: 'Select Alex signature' })).toHaveCount(0);
});

test('signature saving is optional and storage failures do not block signing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open: () => {
          throw new Error('Storage disabled');
        },
      },
    });
  });
  await sample(page, 'sign');
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await expect(page.getByLabel('Save on this device', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Upload image', exact: true }).click();
  await page.getByLabel('Upload signature image', { exact: true }).setInputFiles({
    name: 'signature.jpg',
    mimeType: 'image/jpeg',
    buffer: await signatureFixture(page),
  });
  await expect(page.getByRole('button', { name: 'Use signature', exact: true })).toBeEnabled();
  await page.getByLabel('Save on this device', { exact: true }).check();
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('storage is unavailable');
  await page.getByLabel('Save on this device', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
  await expect(page.locator('.annotation image')).toHaveCount(1);
});

test('offline app cache supports processing without storing documents and can be cleared', async ({
  page,
  context,
  baseURL,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  test.skip(!baseURL?.endsWith(':5181'), 'Offline assets are generated by the production build.');
  test.setTimeout(180000);
  await uploadSavedSignature(page, 'Offline signature');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/privacy');
  await page.getByRole('button', { name: 'Enable offline tools', exact: true }).click();
  await expect(page.getByText('Offline tools are ready.', { exact: false })).toBeVisible({
    timeout: 120000,
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${qa}/device-settings-mobile.png`, fullPage: true });
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((key) => key.startsWith('rovty-pdf-app-'));
    return Promise.all(
      names.map(async (key) =>
        (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname),
      ),
    );
  });
  expect(
    cached
      .flat()
      .every((path) => /^\/($|assets\/|pdfjs\/|fonts\/|favicon\.svg$|pdfium\.wasm$)/.test(path)),
  ).toBe(true);
  await context.setOffline(true);
  await sample(page, 'sign');
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: /Saved signatures/ }).click();
  await page.getByRole('button', { name: 'Select Offline signature', exact: true }).click();
  await page.getByRole('button', { name: 'Use signature', exact: true }).click();
  await save(page, 'Download signed PDF', 'offline-signed.pdf');
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Saved signatures · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear offline cache', exact: true }).click();
  await expect(page.getByText('Offline app files cleared.', { exact: false })).toBeVisible();
  expect(
    await page.evaluate(async () =>
      (await caches.keys()).filter((key) => key.startsWith('rovty-pdf-app-')),
    ),
  ).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Saved signatures · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete saved signatures', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved signatures · 0' })).toBeVisible();
  await context.setOffline(false);
});

test('blocked preference storage does not leave an offline cache installed', async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL?.endsWith(':5181'), 'Offline assets are generated by the production build.');
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage blocked', 'SecurityError');
    };
  });
  await page.goto('/privacy');
  await page.getByRole('button', { name: 'Enable offline tools', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Browser storage is blocked');
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);
});

test('public PDF pages ship readable HTML, unique canonical metadata and valid application schema', async ({
  browser,
  baseURL,
}) => {
  test.skip(!baseURL?.endsWith(':5181'), 'SEO HTML is generated by the production build.');
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const titles = new Set<string>();
  for (const path of ['/', '/edit', '/sign', '/merge', '/privacy']) {
    const response = await page.goto(baseURL + path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
      'href',
      'https://pdf.rovty.com' + path,
    );
    titles.add(await page.title());
    const schema = JSON.parse((await page.locator('#page-schema').textContent()) || '{}');
    expect(
      schema['@graph'].find((item: { '@type': string }) => item['@type'] === 'SoftwareApplication')
        .offers.price,
    ).toBe('0');
  }
  expect(titles.size).toBe(5);
  for (const path of ['/missing-tool', '/edit/missing-tool']) {
    const response = await page.goto(baseURL + path);
    expect(response?.status()).toBe(404);
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('main h1')).toHaveText('That page isn’t here.');
  }
  await context.close();
});
