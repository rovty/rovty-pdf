import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';

const bundled = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
const origin = 'https://pdf.test';
const alice = '00000000-0000-4000-8000-000000000001',
  bob = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const fileBytes = new TextEncoder().encode('%PDF-1.7\nA private document for testing.\n%%EOF');

test('Workers cloud enforces account isolation, link permissions, token scopes and deletion', async (t) => {
  let active = true;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundled.outputFiles[0].text,
      compatibilityDate: '2026-09-29',
      durableObjects: { CLOUD: { className: 'PdfCloud', useSQLite: true } },
      r2Buckets: ['FILES'],
      bindings: {
        DASHBOARD_ORIGIN: 'https://dash.test',
        PDF_WORKER_SECRET: 'test-only-server-secret',
      },
      serviceBindings: { ASSETS: () => new MFResponse('public asset') },
      outboundService: async (request) => {
        assert.equal(request.headers.get('authorization'), 'Bearer test-only-server-secret');
        const data = (await request.json()) as {
          user_id: string;
          session_id: string;
          verifier?: string;
          state?: string;
        };
        if (new URL(request.url).pathname.endsWith('/resolve')) {
          assert.match(data.verifier || '', /^[a-f0-9]{64}$/);
          assert.match(data.state || '', /^[a-f0-9]{64}$/);
          return MFResponse.json({
            active: true,
            user_id: alice,
            session_id: sessionId,
            email: 'alice@example.test',
          });
        }
        return MFResponse.json(
          { active, ...data, email: `${data.user_id === alice ? 'alice' : 'bob'}@example.test` },
          { status: active ? 200 : 401 },
        );
      },
    }),
  );
  t.after(() => mf.dispose());
  const ns = await mf.getDurableObjectNamespace('CLOUD');
  async function session(user: string, raw: string) {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    const result = await ns
      .get(ns.idFromName(`session:${hash}`))
      .fetch('https://internal/internal/session', {
        method: 'PUT',
        body: JSON.stringify({
          user_id: user,
          session_id: sessionId,
          email: `${user}@example.test`,
          expires: Date.now() + 3600000,
        }),
      });
    assert.equal(result.status, 200);
  }
  await session(alice, 'a'.repeat(64));
  await session(bob, 'b'.repeat(64));
  const request = async (
    path: string,
    method = 'GET',
    data?: unknown,
    actor: 'alice' | 'bob' | 'guest' = 'alice',
    extra: Record<string, string> = {},
  ) =>
    mf.dispatchFetch(origin + path, {
      method,
      redirect: 'manual',
      headers: {
        Origin: origin,
        ...(actor === 'guest'
          ? {}
          : { Cookie: `__Host-rovty_pdf_session=${(actor === 'alice' ? 'a' : 'b').repeat(64)}` }),
        ...extra,
        ...(data === undefined
          ? {}
          : {
              'Content-Type': data instanceof Uint8Array ? 'application/pdf' : 'application/json',
            }),
      },
      body:
        data === undefined ? undefined : data instanceof Uint8Array ? data : JSON.stringify(data),
    });
  await t.test(
    'sign-in uses browser-bound state and secure cookies; logout invalidates the PDF session',
    async () => {
      const started = await request('/api/auth/start', 'GET', undefined, 'guest');
      assert.equal(started.status, 303);
      const target = new URL(started.headers.get('location')!);
      assert.equal(target.origin, 'https://dash.test');
      assert.equal(target.pathname, '/connect/pdf');
      const authCookie = started.headers.get('set-cookie')!;
      assert.match(authCookie, /Secure; HttpOnly; SameSite=Lax; Max-Age=300/);
      const state = target.searchParams.get('state');
      const bad = await request(
        '/api/auth/callback?state=wrong&token=test',
        'GET',
        undefined,
        'guest',
        { Cookie: authCookie.split(';')[0] },
      );
      assert.equal(bad.headers.get('location'), '/cloud?auth=failed');
      const callback = await request(
        `/api/auth/callback?state=${state}&token=test`,
        'GET',
        undefined,
        'guest',
        { Cookie: authCookie.split(';')[0] },
      );
      assert.equal(callback.headers.get('location'), '/cloud');
      const cookie = callback.headers
        .get('set-cookie')!
        .match(/__Host-rovty_pdf_session=[a-f0-9]{64}/)![0];
      assert.match(
        callback.headers.get('set-cookie')!,
        /Secure; HttpOnly; SameSite=Lax; Max-Age=604800/,
      );
      assert.equal(
        (await request('/api/account', 'GET', undefined, 'guest', { Cookie: cookie })).status,
        200,
      );
      const logout = await request('/api/auth/logout', 'POST', {}, 'guest', { Cookie: cookie });
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
      assert.equal(
        (await request('/api/account', 'GET', undefined, 'guest', { Cookie: cookie })).status,
        401,
      );
    },
  );
  await t.test('no account or cross-origin writes cannot access cloud data', async () => {
    const account = await request('/api/account');
    assert.equal(account.status, 200, await account.text());
    assert.equal((await request('/api/cloud/workspace', 'GET', undefined, 'guest')).status, 401);
    assert.equal(
      (
        await request('/api/cloud/files', 'POST', fileBytes, 'alice', {
          Origin: 'https://evil.test',
        })
      ).status,
      403,
    );
    assert.equal(
      (await request('/api/cloud/files', 'POST', new TextEncoder().encode('not a PDF'))).status,
      400,
    );
    const result = await request('/api/status');
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
  });
  let file: { id: string; sha256: string };
  await t.test('uploads stay private and ownership is checked on every operation', async () => {
    const result = await request('/api/cloud/files', 'POST', fileBytes, 'alice', {
      'x-file-name': 'private.pdf',
    });
    assert.equal(result.status, 201);
    file = (await result.json()) as typeof file;
    const workspace = (await (await request('/api/cloud/workspace')).json()) as {
      files: unknown[];
      usedBytes: number;
    };
    assert.equal(workspace.files.length, 1);
    assert.equal(workspace.usedBytes, fileBytes.length);
    assert.equal(
      (await request(`/api/cloud/files/${file.id}`, 'GET', undefined, 'bob')).status,
      404,
    );
    assert.equal(
      (await request(`/api/cloud/files/${file.id}`, 'DELETE', undefined, 'bob')).status,
      404,
    );
    const download = await request(`/api/cloud/files/${file.id}`);
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    assert.match(download.headers.get('content-disposition') || '', /attachment/);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), fileBytes);
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
    oversized.set(fileBytes);
    const large = await request('/api/cloud/files', 'POST', oversized);
    assert.equal(large.status, 413);
  });
  let review: { vault: string; token: string; share: { id: string } }, view: typeof review;
  await t.test(
    'link passwords, permissions, revocation and comment resolution are enforced',
    async () => {
      review = (await (
        await request('/api/cloud/shares', 'POST', {
          fileId: file.id,
          label: 'Review',
          mode: 'review',
          days: 1,
          password: ' a-strong-test-password ',
        })
      ).json()) as typeof review;
      view = (await (
        await request('/api/cloud/shares', 'POST', { fileId: file.id, mode: 'view', days: 1 })
      ).json()) as typeof review;
      const access = {
        vault: review.vault,
        token: review.token,
        password: ' a-strong-test-password ',
      };
      assert.equal(
        (await request('/api/public/open', 'POST', { ...access, password: 'wrong' }, 'guest'))
          .status,
        401,
      );
      const opened = await request('/api/public/open', 'POST', access, 'guest');
      assert.equal(opened.status, 200);
      assert.equal(opened.headers.get('x-robots-tag'), 'noindex, nofollow');
      const note = await request(
        '/api/public/comment',
        'POST',
        { ...access, name: '<script>Guest</script>', text: 'Please review page 1', page: 1 },
        'guest',
      );
      assert.equal(note.status, 201);
      const comment = (await note.json()) as { id: string };
      assert.equal(
        (await request(`/api/cloud/comments/${comment.id}`, 'PATCH', { resolved: true })).status,
        200,
      );
      assert.equal(
        (
          await request(
            '/api/public/comment',
            'POST',
            { vault: view.vault, token: view.token, name: 'Guest', text: 'No write permission' },
            'guest',
          )
        ).status,
        403,
      );
      assert.equal(
        (await request('/api/cloud/shares', 'POST', { fileId: file.id, mode: 'view', days: 31 }))
          .status,
        400,
      );
      assert.equal(
        (await request(`/api/cloud/shares/${review.share.id}`, 'PATCH', {})).status,
        200,
      );
      assert.equal((await request('/api/public/download', 'POST', access, 'guest')).status, 404);
    },
  );
  await t.test('signature returns require consent and can only complete once', async () => {
    const share = (await (
      await request('/api/cloud/shares', 'POST', { fileId: file.id, mode: 'sign', days: 7 })
    ).json()) as typeof review;
    const headers = {
      'x-share-vault': share.vault,
      'x-share-token': share.token,
      'x-signer-name': 'Test%20Signer',
      'x-file-name': 'signed.pdf',
    };
    assert.equal(
      (await request('/api/public/sign', 'POST', fileBytes, 'guest', headers)).status,
      400,
    );
    const result = await request('/api/public/sign', 'POST', fileBytes, 'guest', {
      ...headers,
      'x-signing-consent': 'accepted',
    });
    assert.equal(result.status, 201);
    const { receipt } = (await result.json()) as {
      receipt: { originalSha256: string; signedSha256: string; name: string };
    };
    assert.equal(receipt.originalSha256, file.sha256);
    assert.equal(receipt.signedSha256, file.sha256);
    assert.equal(receipt.name, 'Test Signer');
    assert.equal(
      (
        await request('/api/public/sign', 'POST', fileBytes, 'guest', {
          ...headers,
          'x-signing-consent': 'accepted',
        })
      ).status,
      409,
    );
  });
  await t.test(
    'API permissions cannot be expanded and session revocation takes effect immediately',
    async () => {
      const readToken = (await (
        await request('/api/cloud/tokens', 'POST', { label: 'Read', scope: 'read' })
      ).json()) as { token: string; details: { id: string } };
      const writeToken = (await (
        await request('/api/cloud/tokens', 'POST', { label: 'Write', scope: 'write' })
      ).json()) as { token: string };
      const tokenRequest = (
        path: string,
        method = 'GET',
        data?: unknown,
        token = readToken.token,
      ) => request(path, method, data, 'guest', { Authorization: `Bearer ${token}` });
      assert.equal((await tokenRequest('/api/v1/workspace')).status, 200);
      assert.equal((await tokenRequest('/api/v1/files', 'POST', fileBytes)).status, 403);
      assert.equal(
        (
          await tokenRequest(
            '/api/v1/tokens',
            'POST',
            { label: 'No escalation', scope: 'write' },
            writeToken.token,
          )
        ).status,
        403,
      );
      assert.equal(
        (await tokenRequest('/api/v1/workspace', 'DELETE', {}, writeToken.token)).status,
        403,
      );
      active = false;
      assert.equal((await tokenRequest('/api/v1/workspace')).status, 401);
      assert.equal((await request('/api/cloud/workspace')).status, 401);
      active = true;
      await request(`/api/cloud/tokens/${readToken.details.id}`, 'DELETE');
      assert.equal((await tokenRequest('/api/v1/workspace')).status, 401);
    },
  );
  await t.test('permitted Unicode review metadata can grow beyond one storage value', async () => {
    for (let index = 0; index < 50; index++) {
      const response = await request('/api/cloud/comments', 'POST', {
        fileId: file.id,
        text: `${index}: ${'🙂'.repeat(900)}`,
        page: 1,
      });
      assert.equal(response.status, 201, `Comment ${index}: ${await response.text()}`);
    }
    const result = (await (await request('/api/cloud/workspace')).json()) as {
      comments: { text: string }[];
    };
    assert.ok(result.comments.length >= 50);
    assert.ok(result.comments.at(-1)!.text.endsWith('🙂'.repeat(900)));
  });
  await t.test(
    'preferences persist, and deleting cloud data removes stored objects and public access',
    async () => {
      await request('/api/cloud/preferences', 'PUT', {
        defaultTool: 'sign',
        defaultExpiryDays: 14,
      });
      let data = (await (await request('/api/cloud/workspace')).json()) as {
        preferences: { defaultTool: string };
        files: unknown[];
        shares: unknown[];
        tokens: unknown[];
      };
      assert.equal(data.preferences.defaultTool, 'sign');
      assert.equal((await request('/api/cloud/workspace', 'DELETE', {})).status, 200);
      data = (await (await request('/api/cloud/workspace')).json()) as typeof data;
      assert.equal(data.files.length, 0);
      assert.equal(data.shares.length, 0);
      assert.equal(data.tokens.length, 0);
      assert.equal(
        (
          await request(
            '/api/public/open',
            'POST',
            { vault: view.vault, token: view.token },
            'guest',
          )
        ).status,
        404,
      );
      const bucket = await mf.getR2Bucket('FILES');
      assert.equal((await bucket.list()).objects.length, 0);
    },
  );
});
