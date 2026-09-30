import { test, expect, type Page } from '@playwright/test';
import { revealPdfArea } from './canvas';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFString,
  PDFArray,
  StandardFonts,
  rgb,
  degrees,
} from 'pdf-lib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { spacedTextFixture } from '../fixtures/spaced-text';
import { hiddenBreaksFixture } from '../fixtures/hidden-breaks';
import { italicLinesFixture, italicLines } from '../fixtures/italic-lines';

const qa = 'tmp/qa';
test.beforeAll(async () => {
  await mkdir(qa, { recursive: true });
});
const problems = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  problems.set(page, issues);
  page.on('pageerror', (e) => issues.push(e.message));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && !['127.0.0.1', 'localhost'].includes(u.hostname))
      issues.push(u.href);
  });
});
test.afterEach(async ({ page }) => {
  expect(problems.get(page)).toEqual([]);
});
async function ready(page: Page) {
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await expect(page.locator('.text-edit-error')).toHaveCount(0);
}
async function upload(page: Page, bytes: Uint8Array) {
  await page.goto('/edit');
  await page
    .getByLabel('Choose PDF files')
    .setInputFiles({ name: 'editor.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await ready(page);
}
async function draw(page: Page, from: number[], to = from) {
  await revealPdfArea(page, from, to);
  const svg = page.locator('.page-stage[data-active=true] .annotation-layer');
  const box = (await svg.boundingBox())!;
  const [, , w, h] = (await svg.getAttribute('viewBox'))!.split(' ').map(Number);
  await page.mouse.move(box.x + (from[0] / w) * box.width, box.y + (from[1] / h) * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + (to[0] / w) * box.width, box.y + (to[1] / h) * box.height, {
    steps: 5,
  });
  await page.mouse.up();
}
async function selectHighlightText(
  page: Page,
  text: string,
  start: number,
  end: number,
  endText = text,
) {
  await expect(page.locator('.text-highlight-root')).toHaveAttribute('data-ready', 'true');
  const span = page.locator('.pdf-highlight-text-layer span').filter({ hasText: text }).first();
  await span.scrollIntoViewIfNeeded();
  const positions = await Promise.all(
    [
      [text, start],
      [endText, end],
    ].map(([label, offset]) =>
      page
        .locator('.pdf-highlight-text-layer span')
        .filter({ hasText: String(label) })
        .first()
        .evaluate((element, offset) => {
          const range = document.createRange();
          range.setStart(element.firstChild!, offset);
          range.collapse(true);
          const rect = range.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }, Number(offset)),
    ),
  );
  await page.mouse.move(positions[0].x, positions[0].y);
  await page.mouse.down();
  await page.mouse.move(positions[1].x, positions[1].y, { steps: 8 });
  await page.mouse.up();
}
async function save(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = `${qa}/${name}.pdf`;
  await (await pending).saveAs(path);
  return path;
}
function extract(path: string) {
  return execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString();
}
function render(path: string, name: string) {
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '1',
    '-singlefile',
    '-r',
    '100',
    '-png',
    path,
    `${qa}/${name}`,
  ]);
}

for (const mobile of [false, true]) {
  test(`italic letters select and edit as related lines on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await upload(page, await italicLinesFixture());
    await expect(page.getByRole('button', { name: /^Edit: / })).toHaveCount(4);
    const replacements = ['Updated italic words.', 'Updated italic text.', 'Updated bold italic.'];
    for (let i = 0; i < italicLines.length; i++) {
      await page.getByRole('button', { name: 'Edit text', exact: true }).click();
      await page.getByRole('button', { name: `Edit: ${italicLines[i]}`, exact: true }).click();
      const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
      await expect(input).toHaveValue(italicLines[i]);
      await expect(
        page.getByRole('spinbutton', { name: 'On-page font size', exact: true }),
      ).toHaveValue('18');
      await input.fill(replacements[i]);
      await ready(page);
      await expect(page.getByRole('dialog', { name: 'Font replacement', exact: true })).toHaveCount(
        0,
      );
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await ready(page);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await ready(page);
    const saved = await save(page, `italic-lines-${mobile ? 'mobile' : 'desktop'}`);
    const text = extract(saved);
    for (const line of replacements) expect(text).toContain(line);
    expect(text).toContain('Separate column');
    expect(text).not.toContain(italicLines[0]);
    const fonts = execFileSync('/opt/homebrew/bin/pdffonts', [saved]).toString();
    expect(fonts).toContain('NotoSans-Italic');
    expect(fonts).toContain('NotoSans-BoldItalic');
    await page.screenshot({
      path: `${qa}/italic-editor-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    if (!mobile) render(saved, 'italic-lines-browser');
  });
}

test('clicking an English line with hidden breaks preserves it without a multiline error', async ({
  page,
}) => {
  const bytes = await hiddenBreaksFixture();
  const originalPath = `${qa}/hidden-breaks-source.pdf`;
  await writeFile(originalPath, bytes);
  await upload(page, bytes);
  await expect(page.getByRole('button', { name: /^Edit: / })).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit: English line keeps spaces.', exact: true }).click();
  await ready(page);
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await expect(input).toHaveValue('English line keeps spaces.');
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'original',
  );
  const selectedPath = await save(page, 'hidden-breaks-selected');
  const raster = (path: string) =>
    execFileSync('/opt/homebrew/bin/pdftoppm', [
      '-f',
      '1',
      '-singlefile',
      '-scale-to',
      '1000',
      '-png',
      path,
    ]);
  expect(raster(selectedPath).equals(raster(originalPath))).toBe(true);
  await page.getByRole('combobox', { name: 'Text font', exact: true }).selectOption('noto');
  await input.fill('Edited line keeps spaces.');
  await ready(page);
  const editedPath = await save(page, 'hidden-breaks-replaced');
  expect(extract(editedPath)).toContain('Edited line keeps spaces.');
  await page.screenshot({ path: `${qa}/hidden-breaks-editor.png`, fullPage: true });
});

test('only Add text creates text, and Select highlights and smoothly moves original lines', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const sheet = doc.addPage([600, 800]);
  sheet.drawRectangle({ x: 40, y: 645, width: 330, height: 75, color: rgb(0.85, 0.92, 0.98) });
  sheet.drawText('Move this line.', { x: 60, y: 680, font, size: 24 });
  sheet.drawText('Keep this line here.', { x: 60, y: 640, font, size: 20 });
  await upload(page, await doc.save());
  const input = page.getByLabel('Edit text on page', { exact: true });
  await draw(page, [350, 220]);
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await draw(page, [350, 220]);
  await expect(input).toHaveCount(0);
  const line = page.getByRole('button', { name: 'Select: Move this line.', exact: true });
  await line.hover();
  await expect(line).toHaveCSS('cursor', 'grab');
  await expect(line).toHaveCSS('stroke', 'rgb(83, 119, 147)');
  await line.click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(input).toHaveCount(0);
  const hit = page.locator('.annotation-hit');
  const box = (await hit.boundingBox())!;
  const scale = (await page.locator('.page-stage[data-active=true]').boundingBox())!.width / 600;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + 40 * scale, box.y + 10 + 60 * scale, { steps: 8 });
  await expect(page.locator('.text-move-preview')).toHaveAttribute('data-ready', 'true');
  await page.mouse.move(box.x + 20 + 60 * scale, box.y + 10 + 80 * scale, { steps: 8 });
  await expect(page.locator('.page-stage[data-active=true]')).toHaveClass(/is-moving/);
  const translation = await page.locator('.moving-text-layer').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return [matrix.e, matrix.f];
  });
  expect(Math.abs(translation[0] - 60 * scale)).toBeLessThan(0.1);
  expect(Math.abs(translation[1] - 80 * scale)).toBeLessThan(0.1);
  await page.screenshot({ path: `${qa}/select-drag-text.png`, fullPage: true });
  await page.mouse.up();
  await ready(page);
  await expect(page.locator('.text-move-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(
    page.getByRole('button', { name: 'Select: Move this line.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await page.locator('.page-stage[data-active=true] .annotation-layer').focus();
  await page.keyboard.press('ArrowRight');
  await ready(page);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await draw(page, [60, 320]);
  await input.fill('Added intentionally.');
  await input.press('Enter');
  await draw(page, [60, 370]);
  await expect(input).toHaveCount(0);
  const path = await save(page, 'select-drag-text');
  expect(extract(path)).toContain('Move this line.');
  expect(extract(path)).toContain('Keep this line here.');
  expect(extract(path)).toContain('Added intentionally.');
  expect(extract(path)).not.toContain('Type your text');
  expect(execFileSync('/opt/homebrew/bin/pdffonts', [path]).toString()).toContain(
    'Times-BoldItalic',
  );
  const positions = execFileSync('/opt/homebrew/bin/pdftotext', ['-bbox', path, '-']).toString();
  expect(positions).toMatch(/xMin="121\.\d+"[^>]*>Move<\/word>/);
  render(path, 'select-drag-text-export');
});

test('highlight modes support character-range selection and continuous freehand strokes', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = 'Highlight only these words in this line.';
  doc.addPage([600, 800]).drawText(text, { font, size: 20, x: 60, y: 680 });
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Highlight mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Text', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.text-highlight-root')).toHaveAttribute('data-ready', 'true');
  await draw(page, [400, 200]);
  await expect(page.locator('.text-highlight-mark')).toHaveCount(0);
  await selectHighlightText(page, text, 4, 14);
  const highlight = page.locator('.text-highlight-mark rect');
  await expect(highlight).toHaveCount(1);
  const x = Number(await highlight.getAttribute('x')),
    width = Number(await highlight.getAttribute('width'));
  expect(Math.abs(x - 60 - font.widthOfTextAtSize(text.slice(0, 4), 20))).toBeLessThan(1);
  expect(Math.abs(width - font.widthOfTextAtSize(text.slice(4, 14), 20))).toBeLessThan(1);
  expect(width).toBeLessThan(font.widthOfTextAtSize(text, 20) / 2);
  await page.screenshot({ path: `${qa}/text-section-highlight.png`, fullPage: true });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(highlight).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(highlight).toHaveCount(1);
  await page.getByRole('button', { name: 'Freehand', exact: true }).click();
  await expect(page.locator('.text-highlight-root')).toHaveCount(0);
  await page.getByLabel('Highlighter width').fill('20');
  await revealPdfArea(page, [60, 220], [250, 290]);
  const svg = (await page
    .locator('.page-stage[data-active=true] .annotation-layer')
    .boundingBox())!;
  const toScreen = (x: number, y: number) =>
    [svg.x + (x * svg.width) / 600, svg.y + (y * svg.height) / 800] as const;
  await page.mouse.move(...toScreen(60, 220));
  await page.mouse.down();
  await page.mouse.move(...toScreen(140, 290), { steps: 12 });
  await page.mouse.move(...toScreen(250, 220), { steps: 12 });
  await page.mouse.up();
  const freehand = page.locator('.freehand-highlight-mark');
  await expect(freehand).toHaveCount(1);
  await expect(freehand).toHaveAttribute('stroke-width', '20');
  expect((await freehand.getAttribute('points'))!.split(' ').length).toBeGreaterThan(10);
  await expect(page.getByRole('button', { name: 'Highlight', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: `${qa}/freehand-highlight.png`, fullPage: true });
  const path = await save(page, 'highlight-modes');
  expect(extract(path)).toContain(text);
  render(path, 'highlight-modes-export');
  // The center of the V stays unpainted; an arbitrary-area rectangle would cover it.
  const pixels = await page.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      return [
        [100, 255],
        [150, 230],
      ].map(([x, y]) =>
        Array.from(
          ctx.getImageData(
            Math.round((x / 600) * canvas.width),
            Math.round((y / 800) * canvas.height),
            1,
            1,
          ).data,
        ),
      );
    },
    Array.from(await readFile(`${qa}/highlight-modes-export.png`)),
  );
  expect(pixels[0][2]).toBeLessThan(220);
  expect(pixels[1].slice(0, 3).every((channel) => channel > 250)).toBe(true);
});

test('text highlights support multiple lines and mobile selection confirmation', async ({
  page,
}) => {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([600, 800]);
  const first = 'First highlighted line.',
    second = 'Second selected line.';
  [first, second, 'Third untouched line.'].forEach((text, index) =>
    sheet.drawText(text, { x: 60, y: 680 - 30 * index, font, size: 20 }),
  );
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await selectHighlightText(page, first, 6, 6, second);
  const rects = page.locator('.text-highlight-mark rect');
  await expect(rects).toHaveCount(2);
  expect(Number(await rects.nth(0).getAttribute('x'))).toBeGreaterThan(90);
  expect(Math.abs(Number(await rects.nth(1).getAttribute('x')) - 60)).toBeLessThan(1);
  expect(Number(await rects.nth(1).getAttribute('width'))).toBeLessThan(80);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rects).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await page.locator('.pdf-highlight-text-layer').boundingBox())!.width)
    .toBeLessThan(390);
  await ready(page);
  await expect(page.locator('.text-highlight-root')).toHaveAttribute('data-ready', 'true');
  await page
    .locator('.pdf-highlight-text-layer span')
    .filter({ hasText: second })
    .first()
    .evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 7);
      range.setEnd(element.firstChild!, 15);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
  const apply = page.getByRole('button', { name: 'Apply highlight', exact: true });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(rects).toHaveCount(1);
  expect(Number(await rects.getAttribute('width'))).toBeLessThan(85);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${qa}/text-highlight-mobile.png`, fullPage: true });
});

test('text-section highlights stay aligned on rotated cropped pages', async ({ page }) => {
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([600, 800]);
  sheet.setCropBox(50, 100, 500, 600);
  sheet.setRotation(degrees(90));
  const text = 'Highlight this rotated text';
  sheet.drawText(text, { x: 100, y: 300, size: 20, font });
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await selectHighlightText(page, text, 10, 14);
  const rect = page.locator('.text-highlight-mark rect');
  await expect(rect).toHaveCount(1);
  const width = Number(await rect.getAttribute('width')),
    height = Number(await rect.getAttribute('height'));
  expect(width).toBeLessThan(25);
  expect(Math.abs(height - font.widthOfTextAtSize('this', 20))).toBeLessThan(1);
  const path = await save(page, 'highlight-rotated');
  expect(extract(path)).toContain(text);
  render(path, 'highlight-rotated-export');
  await page.screenshot({ path: `${qa}/text-highlight-rotated.png`, fullPage: true });
});

test('a line on a rotated cropped page drags directly and Escape cancels without changing the document', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([600, 800]);
  sheet.setCropBox(50, 100, 500, 600);
  sheet.setRotation(degrees(90));
  sheet.drawText('Move on a rotated page', { x: 100, y: 300, size: 18, font });
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const target = page.getByRole('button', { name: 'Select: Move on a rotated page', exact: true });
  await target.hover();
  const before = (await target.boundingBox())!;
  const originalPosition = [await target.getAttribute('x'), await target.getAttribute('y')];
  await page.mouse.move(before.x + before.width / 2, before.y + 15);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + 55, { steps: 8 });
  await expect(page.locator('.text-move-preview')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: `${qa}/select-drag-rotated.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.text-move-preview')).toHaveCount(0);
  await expect(target).toBeVisible();
  expect([await target.getAttribute('x'), await target.getAttribute('y')]).toEqual(
    originalPosition,
  );
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Edit text on page', { exact: true })).toHaveCount(0);
});

test('editing a line preserves inferred word spaces in the input, caret and exported PDF', async ({
  page,
}) => {
  await upload(page, await spacedTextFixture());
  await page.getByRole('button', { name: 'Edit: Related line keeps spaces.', exact: true }).click();
  const input = page.getByLabel('Edit text on page', { exact: true });
  await expect(input).toHaveValue('Related line keeps spaces.');
  await expect(page.locator('.inline-cursor-layer')).toHaveAttribute('data-exact-layout', 'true');
  await input.press('ArrowLeft');
  for (let i = 0; i < 8; i++) await input.press('ArrowRight');
  await expect
    .poll(() => input.evaluate((el) => (el as HTMLTextAreaElement).selectionStart))
    .toBe(8);
  // The cursor after the first gap is at the actual start of "line", including kerning.
  await expect
    .poll(async () => Number(await page.locator('.inline-text-caret').getAttribute('x1')))
    .toBeCloseTo(118.95, 1);
  await input.pressSequentially('edited  ');
  await expect(input).toHaveValue('Related edited  line keeps spaces.');
  await ready(page);
  await expect(page.locator('.inline-cursor-layer')).toHaveAttribute('data-exact-layout', 'true');
  await page.screenshot({ path: `${qa}/inline-word-spaces.png`, fullPage: true });
  await input.press('ControlOrMeta+z');
  await input.press('ControlOrMeta+Shift+z');
  await expect(input).toHaveValue('Related edited  line keeps spaces.');
  await input.press('Enter');
  const path = await save(page, 'inline-word-spaces');
  expect(extract(path)).toMatch(/Related edited\s+line keeps spaces\./);
  expect(extract(path)).toContain('A separate column.');
  expect(extract(path)).toContain('Next');
  expect(execFileSync('/opt/homebrew/bin/pdffonts', [path]).toString()).toContain('Times-Roman');
  render(path, 'inline-word-spaces-export');
  // Reopen the downloaded file to ensure the spaces were saved, not just shown in the input.
  page.once('dialog', (dialog) => void dialog.accept());
  await upload(page, new Uint8Array(await readFile(path)));
  await page
    .getByRole('button', { name: 'Edit: Related edited line keeps spaces.', exact: true })
    .click();
  await expect(input).toHaveValue('Related edited  line keeps spaces.');
});

test('blank document supports on-page formatting, typed signatures and mobile layout', async ({
  page,
}) => {
  await page.goto('/edit');
  await page.getByRole('button', { name: 'Start with a blank document' }).click();
  await ready(page);
  await page
    .getByRole('toolbar', { name: 'PDF editing tools' })
    .getByRole('button', { name: 'Add text', exact: true })
    .click();
  await draw(page, [70, 120]);
  await page.getByLabel('Edit text on page', { exact: true }).fill('Rovty makes room for ideas.');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Italic', exact: true }).click();
  await page.getByRole('button', { name: 'Underline text', exact: true }).click();
  await ready(page);
  await page.screenshot({ path: `${qa}/editor-contextual.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await expect(page.getByLabel('Edit text on page', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${qa}/editor-contextual-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Finish editing text' }).click();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await page.getByRole('button', { name: 'Type signature' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Alex Morgan');
  await expect(page.getByAltText('Typed signature preview')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Signature style', exact: true })
    .selectOption('Rovty Hand');
  await expect(page.getByRole('button', { name: 'Use signature' })).toBeEnabled();
  await page.screenshot({ path: `${qa}/typed-signature-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Use signature' }).click();
  const path = await save(page, 'contextual-edit');
  expect(extract(path)).toContain('Rovty makes room for ideas.');
  expect(execFileSync('/opt/homebrew/bin/pdffonts', [path]).toString()).toContain(
    'NotoSans-BoldItalic',
  );
  expect(execFileSync('/opt/homebrew/bin/pdfimages', ['-list', path]).toString()).toContain(
    'image',
  );
  render(path, 'contextual-export');
});

test('upload collapses navigation, fits the canvas and edits on the PDF line', async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRomanBoldItalic);
  doc.addPage([600, 800]).drawText('Edit this line here.', { x: 70, y: 660, font, size: 24 });
  doc.getPage(0).drawText('Next line stays separate.', { x: 70, y: 620, font, size: 24 });
  doc.addPage([800, 400]).drawText('Another page.', { x: 70, y: 300, font, size: 24 });
  await upload(page, await doc.save());
  const zoom = page.getByRole('combobox', { name: 'Canvas zoom', exact: true });
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(zoom).toHaveValue('width');
  const fitDifference = () =>
    page.locator('.editor-viewport').evaluate((view) => {
      const style = getComputedStyle(view),
        width = view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return Math.abs(
        view.querySelector('.page-stage[data-active=true]')!.getBoundingClientRect().width - width,
      );
    });
  await expect.poll(fitDifference).toBeLessThan(2);
  expect(
    (await page.locator('.page-stage[data-active=true]').boundingBox())!.width,
  ).toBeGreaterThan(600);
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect.poll(fitDifference).toBeLessThan(2);
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await page.getByRole('button', { name: 'Edit: Edit this line here.', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await expect(page.locator('.on-page-text textarea,.editor-inspector textarea')).toHaveCount(0);
  await expect(page.locator('.inline-cursor-layer')).toHaveAttribute('data-exact-layout', 'true');
  const [inputBox, targetBox] = await Promise.all([
    input.boundingBox(),
    page.locator('.selection-outline').boundingBox(),
  ]);
  expect(Math.abs(inputBox!.y - targetBox!.y)).toBeLessThan(5);
  const stage = (await page.locator('.page-stage[data-active=true]').boundingBox())!,
    pageScale = stage.width / 600;
  await page.mouse.click(
    stage.x + (70 + font.widthOfTextAtSize('Edit ', 24)) * pageScale,
    stage.y + 130 * pageScale,
  );
  await expect
    .poll(() => input.evaluate((node) => (node as HTMLTextAreaElement).selectionStart))
    .toBe(5);
  await input.fill('Edited directly on this line.');
  await ready(page);
  await input.press('End');
  await expect(page.locator('.inline-text-caret')).toHaveCount(1);
  await page.screenshot({ path: `${qa}/inline-fit-width.png`, fullPage: true });
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('Edit this line here.');
  await input.press('ControlOrMeta+Shift+z');
  await expect(input).toHaveValue('Edited directly on this line.');
  await zoom.selectOption('2');
  await expect
    .poll(async () => (await page.locator('.page-stage[data-active=true]').boundingBox())!.width)
    .toBeCloseTo(1200, 0);
  await expect(input).toHaveValue('Edited directly on this line.');
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect(zoom).toHaveValue('1.75');
  await zoom.selectOption('page');
  await expect
    .poll(() =>
      page
        .locator('.editor-viewport')
        .evaluate(
          (view) =>
            view.querySelector('.page-stage[data-active=true]')!.getBoundingClientRect().height -
            view.clientHeight,
        ),
    )
    .toBeLessThan(1);
  await zoom.selectOption('width');
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(fitDifference).toBeLessThan(2);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit: Next line stays separate.', exact: true }).click();
  await expect(input).toHaveValue('Next line stays separate.');
  await input.press('Escape');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(fitDifference).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const path = await save(page, 'inline-fit-width');
  expect(extract(path)).toContain('Edited directly on this line.');
  expect(extract(path)).not.toContain('Edit this line here.');
  expect(execFileSync('/opt/homebrew/bin/pdffonts', [path]).toString()).toContain(
    'Times-BoldItalic',
  );
  render(path, 'inline-fit-width-export');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Close document', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('find and replace handles literal punctuation across pages in one undo step', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++)
    doc.addPage([600, 800]).drawText('Rovty $5. Rovty $5.', { x: 70, y: 650, font, size: 18 });
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Find & replace' }).click();
  await page.getByLabel('Find text', { exact: true }).fill('$5.');
  await expect(page.getByRole('region', { name: 'Find and replace' })).toContainText('4 matches');
  await page.getByLabel('Replace with', { exact: true }).fill('$10.');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Find and replace' })).toContainText(
    'Replaced 4 matches',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Find and replace' })).toContainText(
    '4 matches across',
  );
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByLabel('Find text', { exact: true }).fill('$10.');
  await expect(page.getByRole('region', { name: 'Find and replace' })).toContainText(
    '4 matches across',
  );
  await page.locator('.find-results button').last().click();
  await expect(page.getByLabel('Current page', { exact: true })).toHaveValue('2');
  await ready(page);
  await page.screenshot({ path: `${qa}/find-replace.png`, fullPage: true });
  const path = await save(page, 'find-replace');
  expect(extract(path).match(/\$10\./g)).toHaveLength(4);
  expect(extract(path)).not.toContain('$5.');
});

test('created fields export as interactive forms and can be filled directly on the page', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  await upload(page, await doc.save());
  const create = async (type: string, name: string, y: number, value?: string) => {
    await page.getByLabel('Create form field').selectOption(type);
    await draw(
      page,
      [70, y],
      [type === 'checkbox' || type === 'radio' ? 90 : 320, y + (type === 'multiline' ? 65 : 25)],
    );
    await page.getByLabel('Field name', { exact: true }).fill(name);
    if (value !== undefined)
      await page
        .getByRole('textbox', {
          name: type === 'radio' ? 'Choice value' : 'Default value',
          exact: true,
        })
        .fill(value);
  };
  await create('text', 'Customer', 80, 'Alex');
  await create('multiline', 'Notes', 140, 'First line\nSecond line');
  await create('select', 'Plan', 230, 'Option 2');
  await create('checkbox', 'Approved', 290);
  await page.getByLabel('Selected by default').check();
  await create('radio', 'Contact', 350, 'Email');
  await page.getByLabel('Selected by default').check();
  await create('radio', 'Contact', 400, 'Phone');
  await ready(page);
  const path = await save(page, 'created-forms');
  const pdf = await PDFDocument.load(await readFile(path));
  const form = pdf.getForm();
  expect(form.getFields()).toHaveLength(5);
  expect(form.getTextField('Customer').getText()).toBe('Alex');
  expect(form.getTextField('Notes').isMultiline()).toBe(true);
  expect(form.getDropdown('Plan').getSelected()).toEqual(['Option 2']);
  expect(form.getCheckBox('Approved').isChecked()).toBe(true);
  expect(form.getRadioGroup('Contact').getOptions()).toEqual(['Email', 'Phone']);
  expect(form.getRadioGroup('Contact').getSelected()).toBe('Email');
  render(path, 'created-forms');
  page.on('dialog', (d) => void d.accept());
  await upload(page, new Uint8Array(await readFile(path)));
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByLabel('Form: Customer', { exact: true }).fill('Taylor');
  await page.getByLabel('Form: Contact — Phone', { exact: true }).check();
  await ready(page);
  await page.screenshot({ path: `${qa}/forms-on-page.png`, fullPage: true });
  const filled = await PDFDocument.load(await readFile(await save(page, 'refilled-forms')));
  expect(filled.getForm().getTextField('Customer').getText()).toBe('Taylor');
  expect(filled.getForm().getRadioGroup('Contact').getSelected()).toBe('Phone');
});

test('existing links can be edited or removed and new links target document pages', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sheet.drawText('Links here', { x: 70, y: 700, size: 18, font });
  for (const [i, url] of ['https://example.com/old', 'https://example.com/remove'].entries())
    sheet.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [70, 620 - i * 60, 270, 650 - i * 60],
          Border: [0, 0, 0],
          A: { S: 'URI', URI: PDFString.of(url) },
        }),
      ),
    );
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit link: https://example.com/old', exact: true })
    .click();
  await page.getByLabel('Destination URL', { exact: true }).fill('https://rovty.com/');
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await page
    .getByRole('button', { name: 'Edit link: https://example.com/remove', exact: true })
    .click();
  await page.getByRole('button', { name: 'Delete selected addition', exact: true }).click();
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await draw(page, [70, 300], [260, 335]);
  await page.getByRole('combobox', { name: 'Link destination', exact: true }).selectOption('page');
  await page.getByLabel('Destination page', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  await page.getByRole('button', { name: 'Edit: Links here', exact: true }).click();
  await page.getByLabel('Edit text on page', { exact: true }).fill('Links updated');
  await ready(page);
  const path = await save(page, 'edited-links');
  const pdf = await PDFDocument.load(await readFile(path));
  const annots = pdf.getPage(0).node.Annots()!;
  expect(annots.size()).toBe(2);
  const values = annots.asArray().map((ref) => pdf.context.lookup(ref, PDFDict));
  expect(
    values.some(
      (a) =>
        a
          .lookupMaybe(PDFName.of('A'), PDFDict)
          ?.lookup(PDFName.of('URI'), PDFString)
          .decodeText() === 'https://rovty.com/',
    ),
  ).toBe(true);
  expect(
    values.some(
      (a) =>
        a.lookupMaybe(PDFName.of('Dest'), PDFArray)?.get(0).toString() ===
        pdf.getPage(1).ref.toString(),
    ),
  ).toBe(true);
  expect(extract(path)).toContain('Links updated');
});

test('line annotations and filled shapes export, and redaction covers newly created content', async ({
  page,
}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const sheet = doc.addPage([600, 800]);
  sheet.drawText('A line to annotate.', { x: 70, y: 700, size: 18, font });
  await upload(page, await doc.save());
  await page.getByRole('button', { name: 'Strikethrough', exact: true }).click();
  await page.getByRole('button', { name: 'Edit: A line to annotate.', exact: true }).click();
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await selectHighlightText(page, 'A line to annotate.', 2, 9);
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await draw(page, [360, 80], [470, 130]);
  await page.getByLabel('Fill shape', { exact: true }).check();
  await page.getByLabel('Create form field').selectOption('text');
  await draw(page, [70, 200], [310, 230]);
  await page.getByRole('textbox', { name: 'Field name', exact: true }).fill('Private');
  await page.getByRole('textbox', { name: 'Default value', exact: true }).fill('CONFIDENTIAL');
  await ready(page);
  const annotated = await save(page, 'line-annotations');
  expect(extract(annotated)).toContain('A line to annotate.');
  render(annotated, 'line-annotations');
  await page.getByRole('button', { name: 'Redact', exact: true }).click();
  await draw(page, [60, 185], [330, 250]);
  // Later text must remain covered by the redaction in the export.
  await page.getByRole('button', { name: 'Add text', exact: true }).first().click();
  await draw(page, [75, 210]);
  await page.getByLabel('Edit text on page', { exact: true }).fill('Added later');
  await ready(page);
  const path = await save(page, 'redacted-new-content');
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getForm().getFields()).toHaveLength(0);
  expect(pdf.getPage(0).node.Annots()?.size() || 0).toBe(0);
  expect(extract(path).trim()).toBe('');
  render(path, 'redacted-new-content');
  const pixels = await page.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      const data = ctx.getImageData(
        Math.round((72 / 600) * canvas.width),
        Math.round((204 / 800) * canvas.height),
        Math.round((200 / 600) * canvas.width),
        Math.round((24 / 800) * canvas.height),
      ).data;
      return (
        Array.from(data)
          .filter((_, i) => i % 4 !== 3)
          .reduce((sum, v) => sum + v, 0) /
        ((data.length / 4) * 3)
      );
    },
    Array.from(await readFile(`${qa}/redacted-new-content.png`)),
  );
  expect(pixels).toBeLessThan(3);
});
