import { test, expect, type Page, type Request } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { latinModernFixture } from '../fixtures/latin-modern';
import { onlineFontFixture } from '../fixtures/online-fonts';
import { createHash } from 'node:crypto';
import type { FontCandidate } from '../../shared/fonts';
import { sinhalaLinesFixture, sinhalaLines, sinhalaColumn } from '../fixtures/sinhala-lines';

const fontPath = '/fonts/latin-modern/v2.005/lmroman17-regular.otf';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/fonts/resolve?*', (route) =>
    route.fulfill({ json: { candidates: [] } }),
  );
});

test('Sinhala word fragments select as related lines and replacement removes all old glyphs', async ({
  page,
}) => {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'sinhala-lines.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await sinhalaLinesFixture()),
  });
  await expect(page.getByRole('button', { name: /^Edit: / })).toHaveCount(3);
  const target = page.getByRole('button', { name: `Edit: ${sinhalaLines[0]}`, exact: true });
  const box = await target.boundingBox();
  expect(box!.width).toBeGreaterThan(250);
  await target.click();
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await expect(input).toHaveValue(sinhalaLines[0]);
  await ready(page);
  const replacement = 'අපි සිංහල පෙළ සංස්කරණය කරමු';
  await page.getByRole('combobox', { name: 'Text font', exact: true }).selectOption('sinhala');
  await input.fill(replacement);
  await ready(page);
  const saved = await save(page, 'sinhala-lines-edited');
  const extracted = execFileSync('/opt/homebrew/bin/pdftotext', ['-layout', saved, '-']).toString();
  expect(extracted).toContain(replacement);
  expect(extracted).not.toContain(sinhalaLines[0]);
  // This fixture deliberately writes words in reverse drawing order. External
  // extractors differ on ActualText ordering; the reopened editor checks lines.
  const compact = extracted.replace(/\s/g, '');
  for (const word of sinhalaLines[1].split(' ')) expect(compact).toContain(word);
  expect(compact).toContain(sinhalaColumn.replace(/\s/g, ''));
  await page.screenshot({ path: 'tmp/qa/sinhala-lines-editor.png', fullPage: true });
  await page.reload();
  await page.getByLabel('Choose PDF files').setInputFiles(saved);
  await expect(page.getByRole('button', { name: /^Edit: / })).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: `Edit: ${sinhalaLines[1]}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Edit: ${sinhalaColumn}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Edit: ${replacement}`, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Edit text on page', exact: true })).toHaveValue(
    replacement,
  );
  expect(requests.filter((request) => request.method() !== 'GET')).toEqual([]);
});

test('Iskoola Pota failure offers an explicit Sinhala replacement with shaped Unicode export', async ({
  page,
  context,
  baseURL,
}) => {
  const requests: Request[] = [],
    problems: string[] = [];
  context.on('request', (request) => requests.push(request));
  page.on('pageerror', (error) => problems.push(error.message));
  await context.addCookies([{ name: 'private-font-test', value: 'secret', url: baseURL! }]);
  // Reproduce an unavailable subset name without shipping Microsoft's font.
  const fixture = await onlineFontFixture('Aileron-Regular', 'IskoolaPota');
  const text = 'Rovty ශ්‍රී ලංකාව කො කෝ කෞ ක්‍ර 2026';
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'private-sinhala.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(fixture),
  });
  await page.getByRole('button', { name: 'Edit: ABBA', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit text on page', exact: true }).fill(text);
  await expect(page.locator('.text-edit-error')).toContainText(
    'not available from Rovty’s free-font catalogs',
  );
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'original',
  );
  await page.getByRole('button', { name: 'Use Noto Serif Sinhala', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'sinhala',
  );
  await expect(page.getByTestId('matched-font')).toContainText('replaces the original typeface');
  await expect
    .poll(async () =>
      Number(await page.locator('.inline-cursor-layer .selection-outline').getAttribute('width')),
    )
    .toBeGreaterThan(450);
  await expect(page.getByRole('button', { name: 'Italic', exact: true })).toBeDisabled();
  const regular = await save(page, 'sinhala-browser-Regular');
  expect(execFileSync('/opt/homebrew/bin/pdftotext', ['-raw', regular, '-']).toString()).toContain(
    text,
  );
  const info = execFileSync('/opt/homebrew/bin/pdffonts', [regular]).toString();
  expect(info).toContain('NotoSerifSinhala-Regular');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await ready(page);
  const bold = await save(page, 'sinhala-browser-Bold');
  expect(execFileSync('/opt/homebrew/bin/pdftotext', ['-raw', bold, '-']).toString()).toContain(
    text,
  );
  expect(execFileSync('/opt/homebrew/bin/pdffonts', [bold]).toString()).toContain(
    'NotoSerifSinhala-Bold',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await page.screenshot({ path: 'tmp/qa/sinhala-editor.png', fullPage: true });
  expect(requests.filter((request) => request.method() !== 'GET')).toEqual([]);
  expect(
    requests.filter((request) => new URL(request.url()).origin !== new URL(baseURL!).origin),
  ).toEqual([]);
  for (const request of requests.filter((request) =>
    new URL(request.url()).pathname.startsWith('/fonts/sinhala/'),
  )) {
    expect((await request.allHeaders()).cookie).toBeUndefined();
    expect(request.postData()).toBeNull();
  }
  expect(problems).toEqual([]);
});

for (const name of ['Aileron-Regular', 'Poppins-Regular'] as const) {
  test(`online recovery uses verified ${name} font bytes without uploading document content`, async ({
    page,
    context,
    baseURL,
  }) => {
    const original = await onlineFontFixture(name);
    const extension = name.startsWith('Aileron') ? 'otf' : 'ttf';
    const data = await readFile(`tests/fixtures/online-fonts/${name}.${extension}`);
    const digest = createHash('sha256').update(data).digest('hex');
    const fontPath = name.startsWith('Aileron')
      ? `/api/fonts/file/fontsource/aileron/${digest}`
      : `/api/fonts/file/fontshare/fixture/poppins/${digest}`;
    const candidates: FontCandidate[] = [
      {
        id: name,
        family: name.split('-')[0],
        weight: 400,
        style: 'normal',
        path: fontPath,
        sha256: digest,
        license: name.startsWith('Aileron') ? 'CC0-1.0' : 'OFL-1.1',
      },
    ];
    let wrongFontPath: string | undefined;
    if (name === 'Aileron-Regular') {
      // A catalog can identify a file incorrectly. This placeholder-named font
      // passes catalog identity checks but must fail real outline/width checks.
      const wrongFont = await readFile('tests/fixtures/online-fonts/Poppins-Regular.ttf');
      const wrongHash = createHash('sha256').update(wrongFont).digest('hex');
      wrongFontPath = `/api/fonts/file/fontshare/fixture/mislabeled/${wrongHash}`;
      candidates.unshift({
        ...candidates[0],
        id: 'mislabeled',
        path: wrongFontPath,
        sha256: wrongHash,
      });
      await page.route(`**${wrongFontPath}`, (route) =>
        route.fulfill({
          body: wrongFont,
          contentType: 'font/ttf',
          headers: { 'X-Font-Sha256': wrongHash },
        }),
      );
    }
    const requests: Request[] = [];
    context.on('request', (request) => requests.push(request));
    await context.addCookies([{ name: 'private-font-test', value: 'secret', url: baseURL! }]);
    await page.unroute('**/api/fonts/resolve?*');
    await page.route('**/api/fonts/resolve?*', (route) => route.fulfill({ json: { candidates } }));
    await page.route(`**${fontPath}`, (route) =>
      route.fulfill({
        body: data,
        contentType: `font/${extension}`,
        headers: { 'X-Font-Sha256': digest },
      }),
    );
    await page.goto('/edit');
    await page.getByLabel('Choose PDF files').setInputFiles({
      name: 'private-client.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(original),
    });
    await page.getByRole('button', { name: 'Edit: ABBA', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Edit text on page', exact: true })
      .fill('ABBA Zebra café 2026');
    await ready(page);
    await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
      'original',
    );
    const saved = await save(page, `online-${name}-browser`);
    expect(execFileSync('/opt/homebrew/bin/pdftotext', [saved, '-']).toString()).toContain(
      'ABBA Zebra café 2026',
    );
    expect(execFileSync('/opt/homebrew/bin/pdffonts', [saved]).toString()).toContain(name);
    expect((await PDFDocument.load(await readFile(saved))).getPageCount()).toBe(1);
    await ready(page);
    await page.screenshot({ path: `tmp/qa/online-${name}-editor.png`, fullPage: true });
    expect(requests.filter((request) => request.method() !== 'GET')).toEqual([]);
    expect(
      requests.filter((request) => new URL(request.url()).origin !== new URL(baseURL!).origin),
    ).toEqual([]);
    expect(
      requests.filter((request) => /private-client|Zebra|caf%C3%A9/.test(request.url())),
    ).toEqual([]);
    const lookup = requests.filter(
      (request) => new URL(request.url()).pathname === '/api/fonts/resolve',
    );
    expect(lookup).toHaveLength(1);
    expect(new URL(lookup[0].url()).searchParams.get('name')).toBe(name);
    expect(requests.filter((request) => new URL(request.url()).pathname === fontPath)).toHaveLength(
      1,
    );
    if (wrongFontPath)
      expect(
        requests.filter((request) => new URL(request.url()).pathname === wrongFontPath),
      ).toHaveLength(1);
    for (const request of requests.filter((request) =>
      new URL(request.url()).pathname.startsWith('/api/fonts/'),
    )) {
      const headers = await request.allHeaders();
      expect(headers.cookie).toBeUndefined();
      expect(headers.referer).toBeUndefined();
      expect(request.postData()).toBeNull();
    }
  });
}
async function openSubset(page: Page) {
  await page.goto('/edit');
  await page.getByLabel('Choose PDF files').setInputFiles({
    name: 'private-customer-file.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await latinModernFixture()),
  });
  await page.getByRole('button', { name: 'Edit: ABBA', exact: true }).click();
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
}
async function ready(page: Page) {
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.text-edit-error')).toHaveCount(0);
  await expect(page.locator('.page-loading')).toHaveCount(0);
}
async function save(page: Page, name: string) {
  await mkdir('tmp/qa', { recursive: true });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = `tmp/qa/${name}.pdf`;
  await (await pending).saveAs(path);
  return path;
}

test('Latin Modern recovery downloads only a font, keeps the typeface and exports usable text', async ({
  page,
  context,
  baseURL,
}) => {
  const requests: Request[] = [];
  const problems: string[] = [];
  context.on('request', (request) => requests.push(request));
  page.on('pageerror', (error) => problems.push(error.message));
  await context.addCookies([
    { name: 'test-private-cookie', value: 'not-for-font-downloads', url: baseURL! },
  ]);
  await openSubset(page);
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await input.fill('BABA');
  await ready(page);
  const supportedPath = await save(page, 'supported-latin-modern');
  expect(execFileSync('/opt/homebrew/bin/pdftotext', [supportedPath, '-']).toString()).toContain(
    'BABA',
  );
  expect(requests.filter((r) => r.url().includes('/fonts/latin-modern/'))).toHaveLength(0);

  await input.fill('ABBA Zebra café 2026');
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'original',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
  await expect(input).toHaveValue('BABA');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await ready(page);
  await expect(input).toHaveValue('ABBA Zebra café 2026');
  const path = await save(page, 'font-recovery-browser');
  expect(execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString()).toContain(
    'ABBA Zebra café 2026',
  );
  const fonts = execFileSync('/opt/homebrew/bin/pdffonts', [path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(fonts).toContain('LMRoman17-Regular');
  expect(fonts).not.toContain('Noto');
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1);
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-f',
    '1',
    '-singlefile',
    '-scale-to',
    '1100',
    '-png',
    path,
    'tmp/qa/font-recovery-browser',
  ]);
  await page.screenshot({ path: 'tmp/qa/font-recovery-editor.png', fullPage: true });

  const fontsRequested = requests.filter((r) => new URL(r.url()).pathname === fontPath);
  expect(fontsRequested).toHaveLength(1);
  expect(fontsRequested[0].method()).toBe('GET');
  expect(fontsRequested[0].postData()).toBeNull();
  expect((await fontsRequested[0].allHeaders()).cookie).toBeUndefined();
  expect(requests.filter((r) => r.method() !== 'GET')).toEqual([]);
  expect(requests.filter((r) => new URL(r.url()).origin !== new URL(baseURL!).origin)).toEqual([]);
  expect(requests.some((r) => /private-customer-file|Zebra|caf%C3%A9/.test(r.url()))).toBe(false);
  expect(problems).toEqual([]);
});

test('failed font downloads can be retried on mobile without changing the font', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let blocked = true;
  await page.route(`**${fontPath}`, (route) => (blocked ? route.abort() : route.continue()));
  await openSubset(page);
  const input = page.getByRole('textbox', { name: 'Edit text on page', exact: true });
  await input.fill('Zebra');
  await expect(page.locator('.text-edit-error')).toContainText('could not load a matching');
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'original',
  );
  blocked = false;
  await input.fill('Zebra 2026');
  await ready(page);
  const path = await save(page, 'font-recovery-mobile');
  expect(execFileSync('/opt/homebrew/bin/pdftotext', [path, '-']).toString()).toContain(
    'Zebra 2026',
  );
  await page.screenshot({ path: 'tmp/qa/font-recovery-mobile.png', fullPage: true });
});

test('a mismatched downloaded font is rejected before it can change the document', async ({
  page,
}) => {
  await page.route(`**${fontPath}`, async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'font/otf',
      body: await readFile('public/fonts/latin-modern/v2.005/lmroman12-regular.otf'),
    }),
  );
  await openSubset(page);
  await page.getByRole('textbox', { name: 'Edit text on page', exact: true }).fill('Zebra');
  await expect(page.locator('.text-edit-error')).toContainText('could not load a matching');
  await expect(page.getByRole('combobox', { name: 'Text font', exact: true })).toHaveValue(
    'original',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await ready(page);
});
