import { CLOUD_LIMITS } from '../shared/cloud';
import type { Env, Identity } from './env';
import { body, bytes, equal, fail, HttpError, json, random, sha256 } from './http';
import { handleFonts } from './fonts';
export { PdfCloud } from './cloud';

const SESSION = '__Host-rovty_pdf_session',
  AUTH = '__Host-rovty_pdf_auth';
const COOKIE_AGE = 7 * 86400;
const cookie = (key: string, value: string, seconds: number) =>
  `${key}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const readCookie = (request: Request, key: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${key}=`))
    ?.slice(key.length + 1) || '';
const configured = (env: Env) => Boolean(env.FILES && env.PDF_WORKER_SECRET && env.CLOUD);
function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  cookies.forEach((value) => headers.append('Set-Cookie', value));
  return new Response(null, { status: 303, headers });
}
const sessionStore = async (env: Env, token: string) =>
  env.CLOUD.get(env.CLOUD.idFromName(`session:${await sha256(token)}`));
async function dashboard(env: Env, action: string, data: unknown) {
  const origin = new URL(env.DASHBOARD_ORIGIN);
  if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))
    fail(503, 'Sign-in is not configured.');
  const result = await fetch(`${origin.origin}/api/pdf-auth/${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PDF_WORKER_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
    redirect: 'manual',
  });
  if (!result.ok)
    fail(
      result.status === 401 || result.status === 403 ? 401 : 503,
      result.status === 401 || result.status === 403
        ? 'Your Rovty session has ended. Sign in again.'
        : 'Rovty sign-in is temporarily unavailable.',
    );
  const identity = (await result.json()) as Identity & { active?: boolean };
  if (
    !identity.active ||
    !/^[a-f0-9-]{36}$/i.test(identity.user_id) ||
    !/^[a-f0-9-]{36}$/i.test(identity.session_id)
  )
    fail(401, 'Sign in again.');
  return identity;
}
async function authenticate(request: Request, env: Env) {
  const bearer = request.headers
    .get('authorization')
    ?.match(/^Bearer ([a-f0-9]{64})\.([a-f0-9]{64})$/);
  let identity: Identity,
    scope: 'session' | 'read' | 'write' = 'session';
  let store: DurableObjectStub;
  if (bearer) {
    try {
      store = env.CLOUD.get(env.CLOUD.idFromString(bearer[1]));
    } catch {
      return fail(401, 'Invalid API token.');
    }
    const response = await store.fetch('https://internal/internal/token', {
      headers: { 'x-api-token': bearer[2] },
    });
    if (!response.ok) fail(401, 'Invalid or expired API token.');
    const token = (await response.json()) as { identity: Identity; scope: 'read' | 'write' };
    identity = token.identity;
    scope = token.scope;
  } else {
    const raw = readCookie(request, SESSION);
    if (!/^[a-f0-9]{64}$/.test(raw)) fail(401, 'Sign in to your Rovty account.');
    const response = await (
      await sessionStore(env, raw)
    ).fetch('https://internal/internal/session');
    if (!response.ok) fail(401, 'Your PDF session has ended. Sign in again.');
    identity = (await response.json()) as Identity;
    store = env.CLOUD.get(env.CLOUD.idFromName(`account:${identity.user_id}`));
  }
  const current = await dashboard(env, 'check', {
    user_id: identity.user_id,
    session_id: identity.session_id,
  });
  if (current.user_id !== identity.user_id || current.session_id !== identity.session_id)
    fail(401, 'Sign in again.');
  return { identity: { ...identity, email: current.email }, store, scope };
}
async function handle(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
  if (path === '/api/status' && request.method === 'GET')
    return json({ configured: configured(env), limits: CLOUD_LIMITS, processing: 'browser' });
  if (env.CLOUD_RATE_LIMITER) {
    const result = await env.CLOUD_RATE_LIMITER.limit({
      key: `${path.startsWith('/api/fonts/') ? 'fonts' : path.startsWith('/api/public/') ? 'public' : 'account'}:${request.headers.get('cf-connecting-ip') || 'unknown'}`,
    });
    if (!result.success)
      return json({ error: 'Please wait a minute before trying again.' }, 429, {
        'Retry-After': '60',
      });
  }
  if (path.startsWith('/api/fonts/')) return handleFonts(request);
  if (!configured(env))
    fail(503, 'Cloud workspace is not available yet. The private PDF tools are ready to use.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const apiToken = /^Bearer [a-f0-9]{64}\.[a-f0-9]{64}$/.test(
      request.headers.get('authorization') || '',
    );
    if ((origin && origin !== url.origin) || (!origin && !apiToken))
      fail(403, 'This request must come from Rovty PDF.');
  }
  if (path === '/api/auth/start' && request.method === 'GET') {
    const state = random(),
      verifier = random(),
      challenge = await sha256(verifier);
    const target = new URL('/connect/pdf', env.DASHBOARD_ORIGIN);
    target.searchParams.set('state', state);
    target.searchParams.set('challenge', challenge);
    return redirect(target.href, [cookie(AUTH, `${state}.${verifier}`, 300)]);
  }
  if (path === '/api/auth/callback' && request.method === 'GET') {
    const [state, verifier] = readCookie(request, AUTH).split('.');
    if (!state || !verifier || !equal(state, url.searchParams.get('state') || ''))
      return redirect('/cloud?auth=failed', [cookie(AUTH, '', 0)]);
    try {
      const identity = await dashboard(env, 'resolve', {
        token: url.searchParams.get('token'),
        verifier,
        state,
      });
      identity.expires = Date.now() + COOKIE_AGE * 1000;
      const raw = random();
      const response = await (
        await sessionStore(env, raw)
      ).fetch('https://internal/internal/session', {
        method: 'PUT',
        body: JSON.stringify(identity),
      });
      if (!response.ok) fail(503, 'Could not create PDF session.');
      return redirect('/cloud', [cookie(SESSION, raw, COOKIE_AGE), cookie(AUTH, '', 0)]);
    } catch {
      return redirect('/cloud?auth=failed', [cookie(AUTH, '', 0)]);
    }
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const raw = readCookie(request, SESSION);
    if (/^[a-f0-9]{64}$/.test(raw))
      await (
        await sessionStore(env, raw)
      ).fetch('https://internal/internal/session', { method: 'DELETE' });
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION, '', 0) });
  }
  if (path.startsWith('/api/public/') && request.method === 'POST') {
    const action = path.slice('/api/public/'.length);
    if (!['open', 'download', 'comment', 'sign'].includes(action)) fail(404, 'Not found.');
    const data = action === 'sign' ? null : await body(request);
    const vault = String(data?.vault || request.headers.get('x-share-vault') || ''),
      token = String(data?.token || request.headers.get('x-share-token') || '');
    if (!/^[a-f0-9]{64}$/.test(vault) || !/^[a-f0-9]{64}$/.test(token)) fail(404, 'Invalid link.');
    const password = data
      ? String(data.password || '')
      : decodeURIComponent(request.headers.get('x-share-password') || '');
    if (password.length > 128) fail(400, 'Invalid password.');
    let store: DurableObjectStub;
    try {
      store = env.CLOUD.get(env.CLOUD.idFromString(vault));
    } catch {
      return fail(404, 'Invalid link.');
    }
    const headers = new Headers({
      'x-share-token': token,
      'x-share-password': encodeURIComponent(password),
    });
    if (action === 'sign')
      for (const key of ['x-file-name', 'x-signer-name', 'x-signing-consent', 'content-length']) {
        const value = request.headers.get(key);
        if (value) headers.set(key, value);
      }
    // Read a bounded upload before locking its account object. Slow clients
    // must not occupy the Durable Object's concurrency gate.
    const payload =
      action === 'sign' ? await bytes(request, CLOUD_LIMITS.fileBytes) : JSON.stringify(data);
    return store.fetch(`https://internal/public/${action}`, {
      method: 'POST',
      headers,
      body: payload,
    });
  }
  const { identity, store, scope } = await authenticate(request, env);
  if (path === '/api/account' && request.method === 'GET') return json({ email: identity.email });
  const target = path.replace(/^\/api\/(cloud|v1)/, '');
  if (target === path) fail(404, 'Not found.');
  if (scope === 'read' && request.method !== 'GET')
    fail(403, 'This API token only allows reading.');
  if (
    scope !== 'session' &&
    (target.startsWith('/tokens') || (target === '/workspace' && request.method === 'DELETE'))
  )
    fail(403, 'Sign in to manage API tokens or delete your workspace.');
  if (!/^\/(workspace|files|shares|comments|preferences|tokens)(\/[a-f0-9-]{36})?$/.test(target))
    fail(404, 'Not found.');
  const headers = new Headers({ 'x-identity': JSON.stringify(identity) });
  for (const key of ['content-type', 'content-length', 'x-file-name', 'x-template']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  const payload = ['GET', 'HEAD'].includes(request.method)
    ? null
    : request.body
      ? await bytes(
          request,
          target === '/files' && request.method === 'POST' ? CLOUD_LIMITS.fileBytes : 32768,
        )
      : null;
  return store.fetch(`https://internal${target}`, {
    method: request.method,
    headers,
    body: payload,
  });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      return json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : 'Rovty PDF is temporarily unavailable. Please retry.',
        },
        error instanceof HttpError ? error.status : 503,
      );
    }
  },
} satisfies ExportedHandler<Env>;
