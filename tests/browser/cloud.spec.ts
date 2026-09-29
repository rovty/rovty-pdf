import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdir } from 'node:fs/promises';

// Browser UI against real local Durable Object/R2 code. Only central account
// verification is replaced; no production accounts, storage or emails are used.
test('cloud files, templates, reviews, signature returns and deletion work end to end', async ({
  page,
  context,
}) => {
  const bundled = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  const user = '00000000-0000-4000-8000-000000000001',
    sid = '00000000-0000-4000-8000-000000000002';
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: '2026-09-29',
      durableObjects: { CLOUD: { className: 'PdfCloud', useSQLite: true } },
      r2Buckets: ['FILES'],
      bindings: { DASHBOARD_ORIGIN: 'https://dash.test', PDF_WORKER_SECRET: 'test-only' },
      serviceBindings: { ASSETS: () => new MFResponse('public') },
      outboundService: async () =>
        MFResponse.json({
          active: true,
          user_id: user,
          session_id: sid,
          email: 'alex@example.test',
        }),
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const namespace = await mf.getDurableObjectNamespace('CLOUD');
  const raw = 'a'.repeat(64),
    hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
  await namespace
    .get(namespace.idFromName(`session:${hash}`))
    .fetch('https://internal/internal/session', {
      method: 'PUT',
      body: JSON.stringify({
        user_id: user,
        session_id: sid,
        email: 'alex@example.test',
        expires: Date.now() + 3600000,
      }),
    });
  const requests: string[] = [];
  async function route(target: Page, owner: boolean) {
    await target.route('**/api/**', async (entry) => {
      const req = entry.request();
      requests.push(`${req.method()} ${new URL(req.url()).pathname}`);
      const headers = {
        ...req.headers(),
        ...(owner ? { cookie: `__Host-rovty_pdf_session=${raw}` } : {}),
        origin: new URL(req.url()).origin,
      };
      const response = await mf.dispatchFetch(req.url(), {
        method: req.method(),
        headers,
        body: req.postDataBuffer() || undefined,
      });
      await entry.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
  }
  try {
    await route(page, true);
    await page.goto('/edit');
    await page.getByRole('button', { name: /Try a sample PDF/ }).click();
    await expect(page.locator('.has-document')).toBeVisible();
    expect(requests).toEqual([]);
    await page.goto('/cloud');
    await expect(page.getByText('alex@example.test', { exact: true })).toBeVisible();
    const doc = await PDFDocument.create(),
      font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([595, 842])
      .drawText('Please review and sign this document.', { x: 60, y: 730, size: 18, font });
    const bytes = Buffer.from(await doc.save());
    await page
      .getByLabel('Upload a PDF to cloud')
      .setInputFiles({ name: 'review.pdf', mimeType: 'application/pdf', buffer: bytes });
    await expect(page.locator('.cloud-file')).toHaveCount(1);
    await page.getByRole('button', { name: 'Use as template', exact: true }).click();
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(page.locator('.cloud-file')).toHaveCount(1);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Allow link holders to').selectOption('review');
    await page.getByLabel('Link password (optional)').fill('private-review-password');
    await page.getByRole('button', { name: 'Create share link', exact: true }).click();
    const reviewLink = await page.getByLabel('New share link').inputValue();
    const guest = await context.newPage();
    guest.on('pageerror', (error) => errors.push(error.message));
    await route(guest, false);
    await guest.goto(reviewLink);
    await guest.getByRole('button', { name: 'Open shared PDF' }).click();
    await expect(guest.getByRole('alert')).toContainText('correct link password');
    await guest.getByLabel('Link password (if provided)').fill('private-review-password');
    await guest.getByRole('button', { name: 'Open shared PDF' }).click();
    await expect(guest.locator('.cloud-preview-sheet canvas')).toBeVisible();
    await guest.getByLabel('Your name', { exact: true }).fill('Morgan');
    await guest.getByLabel('Comment', { exact: true }).fill('Looks good. Please sign on page 1.');
    await guest.getByLabel('Page (optional)').fill('1');
    await guest.getByRole('button', { name: 'Post comment' }).click();
    await expect(guest.getByText('Comment posted.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(
      page.getByText('Looks good. Please sign on page 1.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Resolve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
    await mkdir('tmp/qa', { recursive: true });
    await page.screenshot({ path: 'tmp/qa/cloud-review-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await page.getByLabel('Allow link holders to').selectOption('sign');
    await page.getByRole('button', { name: 'Create share link', exact: true }).click();
    const signLink = await page.getByLabel('New share link').inputValue();
    await guest.goto(signLink);
    await guest.getByRole('button', { name: 'Open shared PDF' }).click();
    await guest.getByRole('button', { name: 'Add your signature', exact: true }).click();
    await expect(guest.locator('.has-document')).toBeVisible();
    await guest.getByRole('button', { name: 'Signature', exact: true }).click();
    const canvas = guest.getByLabel('Draw your signature');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await guest.mouse.move(box!.x + 35, box!.y + 60);
    await guest.mouse.down();
    await guest.mouse.move(box!.x + 75, box!.y + 115, { steps: 5 });
    await guest.mouse.move(box!.x + 160, box!.y + 45, { steps: 8 });
    await guest.mouse.up();
    await guest.getByRole('button', { name: 'Use signature', exact: true }).click();
    const download = guest.waitForEvent('download');
    await guest.getByRole('button', { name: 'Download signed PDF', exact: true }).click();
    await download;
    await expect(guest.getByRole('heading', { name: 'Return your signed copy' })).toBeVisible();
    await guest.getByLabel('Your full name').fill('Morgan');
    await guest.getByRole('checkbox', { name: /I agree to use an electronic signature/ }).check();
    await guest.getByRole('button', { name: 'Send signed copy', exact: true }).click();
    await expect(guest.getByRole('heading', { name: 'Signed copy received.' })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Shared links', exact: true }).click();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'tmp/qa/cloud-links-mobile.png', fullPage: true });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete all PDF cloud data', exact: true }).click();
    await expect(
      page.getByText('Cloud data removed and all links and API tokens revoked.', { exact: true }),
    ).toBeVisible();
    await guest.goto(reviewLink);
    await guest.getByLabel('Link password (if provided)').fill('private-review-password');
    await guest.getByRole('button', { name: 'Open shared PDF' }).click();
    await expect(guest.getByRole('alert')).toContainText('expired, was revoked');
    expect(errors).toEqual([]);
    await guest.close();
  } finally {
    await mf.dispose();
  }
});

test('Workers serves noindex private shells and local tools without cloud setup', async ({
  page,
  request,
}) => {
  const status = await request.get('/api/status');
  test.skip(
    status.headers()['content-type']?.includes('text/html'),
    'Requires the Workers emulator',
  );
  expect(status.headers()['cache-control']).toContain('no-store');
  await page.goto('/cloud');
  await expect(
    page.getByRole('heading', { name: 'Cloud workspace is being prepared.' }),
  ).toBeVisible();
  for (const path of ['/cloud', '/shared']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['x-robots-tag']).toContain('noindex');
    expect(await response.text()).toContain('content="noindex, nofollow"');
  }
  await page.goto('/shared');
  await expect(page.getByRole('alert')).toContainText('link is incomplete');
});
