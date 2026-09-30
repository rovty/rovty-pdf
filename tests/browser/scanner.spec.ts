import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { execFileSync } from 'node:child_process';

const corners = [
  [0.17, 0.08],
  [0.86, 0.18],
  [0.79, 0.89],
  [0.09, 0.81],
];
async function photo(page: Page, label = 'ROVTY SCAN', blank = false) {
  const values = await page.evaluate(
    ({ label, blank, corners }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 900;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#343d36';
      ctx.fillRect(0, 0, 1200, 900);
      if (!blank) {
        ctx.beginPath();
        corners.forEach(([x, y], i) =>
          i ? ctx.lineTo(x * 1200, y * 900) : ctx.moveTo(x * 1200, y * 900),
        );
        ctx.closePath();
        ctx.fillStyle = '#eeebda';
        ctx.fill();
        ctx.save();
        ctx.translate(255, 195);
        ctx.rotate(0.1);
        ctx.fillStyle = '#242824';
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText(label, 0, 0);
        ctx.font = '24px sans-serif';
        for (let i = 0; i < 10; i++)
          ctx.fillText(`Document line ${i + 1}: clear text to scan.`, 0, 65 + i * 38);
        ctx.restore();
      }
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { label, blank, corners },
  );
  return { name: label + '.png', mimeType: 'image/png', buffer: Buffer.from(values, 'base64') };
}
async function start(page: Page) {
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Open scanner & import photos' }).click();
  await expect(page.getByRole('heading', { name: 'Scan to PDF', exact: true })).toBeVisible();
}
async function ready(page: Page) {
  await expect(page.locator('.scan-progress')).toHaveCount(0, { timeout: 60000 });
  await expect(page.locator('.scan-result-image')).toHaveAttribute('data-current', 'true', {
    timeout: 60000,
  });
  await expect(page.locator('.error-banner')).toHaveCount(0);
}
async function save(page: Page, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = `tmp/qa/${name}.pdf`;
  await (await pending).saveAs(path);
  return PDFDocument.load(await readFile(path), { updateMetadata: false });
}
test.beforeAll(() => mkdir('tmp/qa', { recursive: true }));

test('scanner is discoverable, prerendered and loads its private processing engine only on use', async ({
  page,
  request,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/');
  await page.getByLabel('Search PDF tools').fill('scan camera');
  await expect(page.locator('.tool-card[href="/scan"]')).toBeVisible();
  await page.locator('.tool-card[href="/scan"]').click();
  await expect(page.getByRole('heading', { name: 'Scan to PDF', exact: true })).toBeVisible();
  expect(requests.some((url) => url.includes('/scanner/opencv'))).toBe(false);
  const html = await (await request.get('/scan')).text();
  expect(html).toContain('Automatic edge detection');
  expect(html).toContain('https://pdf.rovty.com/scan');
  expect((await request.get('/scan')).headers()['permissions-policy']).toContain('camera=(self)');
  const shellCsp = (await request.get('/scan')).headers()['content-security-policy'];
  expect(shellCsp).not.toContain("'unsafe-eval'");
  const worker = (await readdir('dist/assets')).find((name) => name.startsWith('scanner.worker-'))!;
  const workerCsp = (await request.get(`/assets/${worker}`)).headers()['content-security-policy'];
  expect(workerCsp).toContain("connect-src 'none'");
  expect(workerCsp).toContain("default-src 'none'");
});

test('detects perspective corners, updates filters, reorders pages and exports a private ID sheet', async ({
  page,
}) => {
  const errors: string[] = [],
    external: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!/^(http:\/\/127\.0\.0\.1|blob:|data:)/.test(r.url())) external.push(r.url());
  });
  await start(page);
  const first = await photo(page),
    second = await photo(page, 'SECOND SIDE');
  await page.getByLabel('Import scan photos').setInputFiles([first, second]);
  await ready(page);
  await expect(page.getByRole('button', { name: 'Review scan 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Adjust edges', exact: true }).click();
  const detected = await page
    .locator('.scan-crop svg g circle:last-child')
    .evaluateAll((nodes) =>
      nodes.map((n) => [Number(n.getAttribute('cx')) / 1000, Number(n.getAttribute('cy')) / 1000]),
    );
  detected.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(corners[i][0], 1);
    expect(p[1]).toBeCloseTo(corners[i][1], 1);
  });
  const corner = page.getByRole('slider', { name: 'Top left crop corner' });
  await corner.focus();
  const before = await corner.getAttribute('aria-valuetext');
  await page.keyboard.press('ArrowRight');
  expect(await corner.getAttribute('aria-valuetext')).not.toBe(before);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Black & white', exact: true }).click();
  await ready(page);
  const colors = await page
    .locator('.scan-result-image')
    .evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      const c = document.createElement('canvas');
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      c.getContext('2d')!.drawImage(image, 0, 0);
      const pixels = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let gray = 0,
        binary = 0,
        total = 0;
      for (let i = 0; i < pixels.length; i += 160) {
        if (Math.abs(pixels[i] - pixels[i + 1]) < 3 && Math.abs(pixels[i] - pixels[i + 2]) < 3)
          gray++;
        if (pixels[i] < 25 || pixels[i] > 230) binary++;
        total++;
      }
      return { gray: gray / total, binary: binary / total };
    });
  expect(colors.gray).toBeGreaterThan(0.99);
  expect(colors.binary).toBeGreaterThan(0.95);
  await page.getByRole('button', { name: 'Apply color to all', exact: true }).click();
  // Batch settings must reach every thumbnail, including pages never opened for review.
  await expect
    .poll(async () =>
      page.locator('.scan-pages li img').evaluateAll(async (nodes) => {
        const values = await Promise.all(
          nodes.map(async (node) => {
            const img = node as HTMLImageElement;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let gray = 0,
              total = 0;
            for (let i = 0; i < pixels.length; i += 16) {
              if (
                Math.abs(pixels[i] - pixels[i + 1]) < 3 &&
                Math.abs(pixels[i] - pixels[i + 2]) < 3
              )
                gray++;
              total++;
            }
            return gray / total;
          }),
        );
        return Math.min(...values);
      }),
    )
    .toBeGreaterThan(0.99);
  await page
    .getByRole('button', { name: 'Review scan 2', exact: true })
    .dragTo(page.getByRole('button', { name: 'Review scan 1', exact: true }));
  await page.getByRole('button', { name: 'ID card', exact: true }).click();
  await page.getByLabel('Scan PDF name').fill('My ID copy');
  const pdf = await save(page, 'scanner-id-pair');
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28);
  expect(pdf.getTitle()).toBe('My ID copy');
  expect(pdf.getProducer()).toBe('Rovty PDF');
  execFileSync('/opt/homebrew/bin/pdftoppm', [
    '-scale-to',
    '1000',
    '-singlefile',
    '-png',
    'tmp/qa/scanner-id-pair.pdf',
    'tmp/qa/scanner-id-pair',
  ]);
  await page.screenshot({ path: 'tmp/qa/scanner-desktop.png' });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.getByRole('button', { name: 'Open in editor', exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.locator('.pdf-editor')).toHaveAttribute('aria-busy', 'false');
});

test('mobile scan review supports manual crop, rotation, receipts, deletion and download', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page.getByRole('button', { name: 'Receipt', exact: true }).click();
  await page
    .getByLabel('Import scan photos')
    .setInputFiles([await photo(page, 'FIRST'), await photo(page, 'SECOND')]);
  await ready(page);
  await page.getByRole('button', { name: 'Rotate scan clockwise', exact: true }).click();
  await ready(page);
  await expect(page.getByLabel('Scan PDF page size')).toHaveValue('fit');
  await page.getByRole('button', { name: 'Review scan 1', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Delete selected scan', exact: true }).click();
  await ready(page);
  await expect(page.getByRole('button', { name: 'Review scan 2', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'tmp/qa/scanner-mobile.png', fullPage: true });
  const pdf = await save(page, 'scanner-receipt');
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getWidth() / pdf.getPage(0).getHeight()).toBeCloseTo(663 / 842, 1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear this scan session', exact: true }).click();
  await expect(page.locator('.scan-result-image')).toHaveCount(0);
});

test('unsupported and corrupt images recover without losing existing scans', async ({ page }) => {
  await start(page);
  await page.getByLabel('Import scan photos').setInputFiles(await photo(page));
  await ready(page);
  await page
    .getByLabel('Import scan photos')
    .setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await expect(page.getByRole('button', { name: 'Review scan 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss scanner error' }).click();
  await page
    .getByLabel('Import scan photos')
    .setInputFiles(await photo(page, 'LOW CONTRAST', true));
  await expect(page.getByRole('slider', { name: 'Top left crop corner' })).toBeVisible({
    timeout: 60000,
  });
  await expect(page.locator('.error-banner')).toHaveCount(0);
});

test('camera permission denial offers photo import without requesting a microphone', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async (constraints: MediaStreamConstraints) => {
        (window as any).requestedMedia = constraints;
        throw new DOMException('Denied', 'NotAllowedError');
      },
    });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Use camera', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was not granted');
  expect(await page.evaluate(() => (window as any).requestedMedia.audio)).toBe(false);
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
  await page.getByLabel('Import scan photos').setInputFiles(await photo(page));
  await ready(page);
});

test('camera captures multiple pages, auto capture avoids duplicates and tracks stop on close', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const c = document.createElement('canvas');
        c.width = 1000;
        c.height = 750;
        const ctx = c.getContext('2d')!;
        const paint = (documentVisible: boolean) => {
          ctx.fillStyle = '#303931';
          ctx.fillRect(0, 0, 1000, 750);
          if (documentVisible) {
            ctx.fillStyle = '#faf8ea';
            ctx.fillRect(160, 70, 680, 610);
            ctx.fillStyle = '#18221b';
            ctx.font = 'bold 32px sans-serif';
            for (let i = 0; i < 10; i++) ctx.fillText('Clear camera scan ' + i, 205, 145 + i * 43);
          }
        };
        paint(true);
        const stream = c.captureStream(10);
        (window as any).scannerMedia = stream;
        (window as any).scannerPaint = paint;
        return stream;
      },
    });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Use camera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Capture page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Capture page' }).click();
  await expect(page.getByText('1 page captured', { exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByLabel('Auto capture when steady').check();
  await page.evaluate(() => (window as any).scannerPaint(false));
  await expect(
    page.getByText('Show all four edges against a contrasting background.', { exact: true }),
  ).toBeVisible();
  // Wait for the three absent frames required to re-arm auto capture.
  await page.waitForTimeout(1400);
  await page.evaluate(() => (window as any).scannerPaint(true));
  await expect(page.getByText('2 pages captured', { exact: true })).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await expect(page.getByText('2 pages captured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review scans', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).scannerMedia
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  await ready(page);
});

test('a failed scanner-engine download can be retried without losing the photo workflow', async ({
  page,
}) => {
  await page.route('**/scanner/opencv-5.0.0.js', (route) => route.abort(), { times: 1 });
  await start(page);
  const file = await photo(page);
  await page.getByLabel('Import scan photos').setInputFiles(file);
  await expect(page.getByRole('alert')).toContainText('The scanner could not load.');
  await page.getByLabel('Import scan photos').setInputFiles(file);
  await ready(page);
});

test('cached scanner processes and exports photos offline without caching document data', async ({
  page,
  context,
}) => {
  await page.goto('/privacy');
  await page.getByRole('button', { name: 'Enable offline tools', exact: true }).click();
  await expect(page.getByText('Offline tools are ready.', { exact: false })).toBeVisible({
    timeout: 120000,
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  const file = await photo(page, 'OFFLINE SCAN');
  const before = await page.evaluate(async () => {
    const cache = await caches.open(
      (await caches.keys()).find((name) => name.startsWith('rovty-pdf-app-'))!,
    );
    return (await cache.keys()).map((request) => request.url).sort();
  });
  await context.setOffline(true);
  await start(page);
  await page.getByLabel('Import scan photos').setInputFiles(file);
  await ready(page);
  expect((await save(page, 'scanner-offline')).getPageCount()).toBe(1);
  expect(
    await page.evaluate(async () => {
      const cache = await caches.open(
        (await caches.keys()).find((name) => name.startsWith('rovty-pdf-app-'))!,
      );
      return (await cache.keys()).map((request) => request.url).sort();
    }),
  ).toEqual(before);
  await context.setOffline(false);
});

test('closing the scanner before camera permission resolves stops the late stream', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () =>
        new Promise<MediaStream>((resolve) => {
          (window as any).grantScannerCamera = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            const stream = canvas.captureStream(1);
            (window as any).lateScannerMedia = stream;
            resolve(stream);
          };
        }),
    });
  });
  await page.goto('/scan');
  await page.getByRole('button', { name: 'Use camera', exact: true }).click();
  await expect(page.getByLabel('Live camera preview')).toBeVisible();
  await page.getByRole('button', { name: 'Close camera', exact: true }).click();
  await page.evaluate(() => (window as any).grantScannerCamera());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).lateScannerMedia
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    )
    .toBe(true);
});

test.describe('scan crop on touch screens', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('finger dragging adjusts the corner without scrolling the document', async ({ page }) => {
    await start(page);
    await page.getByLabel('Import scan photos').setInputFiles(await photo(page));
    await ready(page);
    await page.getByRole('button', { name: 'Adjust edges', exact: true }).click();
    const target = page.getByRole('slider', { name: 'Top left crop corner' });
    const point = target.locator('circle').last();
    await point.scrollIntoViewIfNeeded();
    const before = Number(await point.getAttribute('cx')),
      rect = (await point.boundingBox())!;
    const client = await page.context().newCDPSession(page),
      x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 4, y: y + i * 2 }],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Number(await point.getAttribute('cx'))).toBeGreaterThan(before + 10);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await ready(page);
  });
});
