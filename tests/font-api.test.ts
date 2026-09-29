import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import fixture from './fixtures/online-fonts/providers.json';
import { matchFontFamily } from '../shared/fonts.ts';

const source = await readFile('tests/fixtures/online-fonts/Aileron-Regular.otf');
const share = await readFile('tests/fixtures/online-fonts/Poppins-Regular.ttf');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bundled = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
type Mode = {
  sourceDown?: boolean;
  shareDown?: boolean;
  corrupt?: boolean;
  privateLicense?: boolean;
  unsafeUrl?: boolean;
  redirect?: boolean;
};
function setup(mode: Mode = {}) {
  const calls: string[] = [];
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: '2026-09-29',
      serviceBindings: { ASSETS: () => new MFResponse('asset') },
      outboundService: async (request) => {
        const url = new URL(request.url);
        calls.push(url.href);
        assert.equal(request.method, 'GET');
        assert.equal(request.headers.get('cookie'), null);
        assert.equal(request.headers.get('authorization'), null);
        assert.equal(request.headers.get('cf-connecting-ip'), null);
        if (url.origin === 'https://api.fontsource.org') {
          if (mode.sourceDown) return new MFResponse('unavailable', { status: 503 });
          if (url.pathname === '/v1/registry/families') return MFResponse.json([fixture.aileron]);
          if (url.pathname === '/v1/registry/families/aileron')
            return MFResponse.json(fixture.aileron);
          if (url.pathname === `/v1/registry/sources/${hash(source)}`)
            return mode.redirect
              ? new MFResponse(null, {
                  status: 302,
                  headers: { Location: 'https://attacker.example/font.ttf' },
                })
              : new MFResponse(mode.corrupt ? share : source);
        }
        if (url.href === 'https://api.fontshare.com/v2/fonts') {
          if (mode.shareDown) return new MFResponse('unavailable', { status: 503 });
          const item = structuredClone(fixture.poppins);
          if (mode.privateLicense) item.license_type = 'itf_ffl';
          if (mode.unsafeUrl) item.styles[0].file = '//attacker.example/private';
          return MFResponse.json({ fonts: [item] });
        }
        if (url.origin === 'https://cdn.fontshare.com') return new MFResponse(share);
        throw new Error(`Unexpected font request: ${url.href}`);
      },
    }),
  );
  const get = (path: string, extra: Record<string, string> = {}) =>
    mf.dispatchFetch(`https://pdf.test${path}`, {
      headers: {
        Cookie: 'private-session=secret',
        Authorization: 'Bearer private',
        'cf-connecting-ip': '192.0.2.1',
        ...extra,
      },
    });
  return { mf, calls, get };
}

test('font family matching preserves weight, style and family boundaries', () => {
  assert.deepEqual(matchFontFamily('ABCDEF+Aileron-SemiBoldItalic-9742', 'Aileron'), {
    weight: 600,
    style: 'italic',
  });
  assert.deepEqual(matchFontFamily('Poppins-Regular', 'Poppins'), { weight: 400, style: 'normal' });
  assert.equal(matchFontFamily('RobotoSlab-Regular', 'Roboto'), undefined);
  assert.equal(matchFontFamily('Poppins-CondensedBold', 'Poppins'), undefined);
  assert.equal(matchFontFamily('Private-Font', 'Poppins'), undefined);
});

test('font APIs work without cloud setup and deliver verified fonts from both providers', async (t) => {
  const { mf, get, calls } = setup();
  t.after(() => mf.dispose());
  for (const [name, bytes] of [
    ['Aileron-Regular', source],
    ['Poppins-Regular', share],
  ] as const) {
    const response = await get(`/api/fonts/resolve?name=${name}`);
    assert.equal(response.status, 200);
    const result = (await response.json()) as { candidates: { path: string; license: string }[] };
    assert.equal(result.candidates.length, 1);
    const file = await get(result.candidates[0].path);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('X-Font-Sha256'), hash(bytes));
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(bytes));
    assert.match(file.headers.get('cache-control')!, /immutable/);
    const before = calls.length;
    await get(result.candidates[0].path);
    assert.equal(calls.length, before, 'public catalogs and font bytes reuse the edge cache');
  }
  const unknown = (await (await get('/api/fonts/resolve?name=Private-Font')).json()) as {
    candidates: unknown[];
  };
  assert.deepEqual(unknown.candidates, []);
});

test('a provider outage allows the other provider and is never reported as a definitive no-match', async (t) => {
  const { mf, get } = setup({ sourceDown: true });
  t.after(() => mf.dispose());
  const response = await get('/api/fonts/resolve?name=Poppins-Regular');
  assert.equal(response.status, 200);
  const found = (await response.json()) as { candidates: unknown[]; incomplete: boolean };
  assert.equal(found.candidates.length, 1);
  assert.equal(found.incomplete, true);
  assert.equal((await get('/api/fonts/resolve?name=Aileron-Regular')).status, 503);
});

test('font routes reject uploads, extra data, external URLs and cross-site use', async (t) => {
  const { mf, get, calls } = setup();
  t.after(() => mf.dispose());
  assert.equal(
    (
      await mf.dispatchFetch('https://pdf.test/api/fonts/resolve', {
        method: 'POST',
        body: 'private PDF',
      })
    ).status,
    405,
  );
  assert.equal((await get('/api/fonts/resolve?name=Poppins&text=private')).status, 400);
  assert.equal((await get('/api/fonts/resolve?name=https%3A%2F%2Fprivate.example')).status, 400);
  assert.equal(
    (await get('/api/fonts/resolve?name=Poppins', { 'sec-fetch-site': 'cross-site' })).status,
    403,
  );
  assert.equal((await get('/api/fonts/file/custom/https/private')).status, 404);
  assert.deepEqual(calls, []);
});

test('font integrity failures are not cached as usable font files', async (t) => {
  const mode = { corrupt: true };
  const { mf, get } = setup(mode);
  t.after(() => mf.dispose());
  const found = (await (await get('/api/fonts/resolve?name=Aileron-Regular')).json()) as {
    candidates: { path: string }[];
  };
  assert.equal((await get(found.candidates[0].path)).status, 503);
  mode.corrupt = false;
  assert.equal((await get(found.candidates[0].path)).status, 200);
});

test('Fontshare fonts outside the open-source license are excluded', async (t) => {
  const { mf, get } = setup({ privateLicense: true });
  t.after(() => mf.dispose());
  const found = (await (await get('/api/fonts/resolve?name=Poppins-Regular')).json()) as {
    candidates: unknown[];
  };
  assert.deepEqual(found.candidates, []);
  const path = `/api/fonts/file/fontshare/${fixture.poppins.id}/${fixture.poppins.styles[0].id}/${'a'.repeat(64)}`;
  assert.equal((await get(path)).status, 404);
});

test('untrusted provider asset locations never become an arbitrary proxy', async (t) => {
  const { mf, get, calls } = setup({ unsafeUrl: true });
  t.after(() => mf.dispose());
  assert.equal((await get('/api/fonts/resolve?name=Poppins-Regular')).status, 503);
  assert.ok(
    calls.every((url) =>
      ['api.fontsource.org', 'api.fontshare.com'].includes(new URL(url).hostname),
    ),
  );
});

test('font downloads reject redirects and family identifiers outside the public catalog', async (t) => {
  const { mf, get, calls } = setup({ redirect: true });
  t.after(() => mf.dispose());
  const found = (await (await get('/api/fonts/resolve?name=Aileron-Regular')).json()) as {
    candidates: { path: string }[];
  };
  assert.equal((await get(found.candidates[0].path)).status, 503);
  assert.equal(
    (await get(`/api/fonts/file/fontsource/unknown-family/${hash(source)}`)).status,
    404,
  );
  assert.ok(calls.some((url) => url.includes('/registry/sources/')));
  assert.ok(
    calls.every((url) =>
      ['api.fontsource.org', 'api.fontshare.com'].includes(new URL(url).hostname),
    ),
  );
  assert.ok(!calls.some((url) => url.includes('unknown-family')));
});
