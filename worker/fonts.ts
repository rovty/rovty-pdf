import {
  fontKey,
  matchFontFamily,
  MAX_FONT_BYTES,
  MAX_FONT_CANDIDATES,
  type FontCandidate,
} from '../shared/fonts';
import { fail, json, sha256 } from './http';

const FONTSOURCE = 'https://api.fontsource.org';
const FONTSHARE = 'https://api.fontshare.com';
const LICENSES = new Set([
  'OFL-1.1',
  'Apache-2.0',
  'UFL-1.0',
  'Bitstream-Vera',
  'CC0-1.0',
  'MIT',
  'Unlicense',
]);
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
interface Family {
  id: string;
  family: string;
  status: string;
  license?: { id: string };
}
interface Source {
  sha256: string;
  format: string;
  size: number;
  type: string;
  style: string;
  weight: number | { default: number };
  filename: string;
}
interface SourceFamily extends Family {
  sources: Source[];
}
interface ShareStyle {
  id: string;
  file: string;
  is_variable: boolean;
  is_italic: boolean;
  weight: { weight: number };
}
interface ShareFamily {
  id: string;
  name: string;
  license_type: string;
  styles: ShareStyle[];
}

async function limited(response: Response, limit: number) {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > limit)
    throw new Error('Font provider response unavailable.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Font provider response empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error('Font response too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

// All URLs are constructed from validated provider records, never from a URL
// supplied by a user. Redirects, user cookies and authorization are not forwarded.
async function upstream(url: string, limit: number, ttl = 86400, expectedFont?: string | null) {
  const key = new Request(`https://pdf.rovty.com/api/fonts/internal-cache/${await sha256(url)}`);
  const cache = typeof caches === 'undefined' ? undefined : caches.default;
  const cached = await cache?.match(key);
  if (cached) return limited(cached, limit);
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { Accept: 'application/json, font/ttf, font/otf' },
    signal: AbortSignal.timeout(12000),
  });
  const data = await limited(response, limit);
  if (expectedFont !== undefined) {
    const signature = new TextDecoder().decode(data.subarray(0, 4));
    if (
      !['OTTO', '\u0000\u0001\u0000\u0000', 'true'].includes(signature) ||
      (expectedFont && (await sha256(data)) !== expectedFont)
    )
      throw new Error('Invalid font program.');
  } else JSON.parse(new TextDecoder().decode(data));
  await cache?.put(
    key,
    new Response(data, { headers: { 'Cache-Control': `public, max-age=${ttl}` } }),
  );
  return data;
}
async function metadata<T>(url: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await upstream(url, 3 * 1024 * 1024)));
}
const allowedFamily = (family: Family) =>
  family.status === 'active' && LICENSES.has(family.license?.id || '') && ID.test(family.id);
const sourceStyle = (style: string) => (style === 'oblique' ? 'italic' : style);
async function sourceFamilies() {
  const families = await metadata<Family[]>(`${FONTSOURCE}/v1/registry/families`);
  if (!Array.isArray(families)) throw new Error('Invalid font catalog.');
  return families.filter(allowedFamily);
}

async function sourceCandidates(name: string): Promise<FontCandidate[]> {
  const family = (await sourceFamilies())
    .filter((f) => matchFontFamily(name, f.family))
    .sort((a, b) => fontKey(b.family).length - fontKey(a.family).length)[0];
  if (!family) return [];
  const variant = matchFontFamily(name, family.family)!;
  const detail = await metadata<SourceFamily>(`${FONTSOURCE}/v1/registry/families/${family.id}`);
  if (!allowedFamily(detail) || detail.id !== family.id || !Array.isArray(detail.sources))
    return [];
  return detail.sources
    .filter(
      (s) =>
        s.type === 'static' &&
        s.weight === variant.weight &&
        sourceStyle(s.style) === variant.style &&
        ['ttf', 'otf'].includes(s.format) &&
        s.size > 0 &&
        s.size <= MAX_FONT_BYTES &&
        HASH.test(s.sha256),
    )
    .slice(0, 3)
    .map((s) => ({
      id: `fontsource:${s.sha256}`,
      family: family.family,
      ...variant,
      path: `/api/fonts/file/fontsource/${family.id}/${s.sha256}`,
      sha256: s.sha256,
      license: detail.license!.id,
    }));
}

function shareUrl(style: ShareStyle) {
  if (!/^\/\/cdn\.fontshare\.com\/wf\/(?:[A-Z0-9]+\/){2}[A-Z0-9]+$/.test(style.file))
    throw new Error('Invalid font asset location.');
  return `https:${style.file}.ttf`;
}
async function shareFamilies() {
  const catalog = await metadata<{ fonts: ShareFamily[] }>(`${FONTSHARE}/v2/fonts`);
  if (!Array.isArray(catalog.fonts)) throw new Error('Invalid font catalog.');
  return catalog.fonts.filter((f) => f.license_type === 'sil_ofl' && UUID.test(f.id));
}
async function shareCandidates(name: string): Promise<FontCandidate[]> {
  const families = await shareFamilies();
  const family = families
    .filter((f) => matchFontFamily(name, f.name))
    .sort((a, b) => fontKey(b.name).length - fontKey(a.name).length)[0];
  if (!family) return [];
  const variant = matchFontFamily(name, family.name)!;
  const styles = family.styles
    .filter(
      (s) =>
        !s.is_variable &&
        UUID.test(s.id) &&
        s.weight?.weight === variant.weight &&
        s.is_italic === (variant.style === 'italic'),
    )
    .slice(0, 3);
  return Promise.all(
    styles.map(async (style) => ({
      id: `fontshare:${style.id}`,
      family: family.name,
      ...variant,
      path: `/api/fonts/file/fontshare/${family.id}/${style.id}/${await sha256(shareUrl(style))}`,
      license: 'OFL-1.1',
    })),
  );
}

export async function resolveFontCandidates(name: string) {
  const results = await Promise.allSettled([sourceCandidates(name), shareCandidates(name)]);
  const candidates = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .slice(0, MAX_FONT_CANDIDATES);
  const incomplete = results.some((r) => r.status === 'rejected');
  // An outage must not be cached or represented as "font does not exist".
  if (!candidates.length && incomplete)
    fail(503, 'Font lookup is temporarily unavailable. Try editing again.');
  return { candidates, incomplete };
}

async function fontFile(parts: string[]) {
  const [provider, family, source, revision] = parts;
  let data: Uint8Array, expected: string | undefined;
  if (provider === 'fontsource' && parts.length === 3 && ID.test(family) && HASH.test(source)) {
    if (!(await sourceFamilies()).some((entry) => entry.id === family))
      fail(404, 'This font is unavailable.');
    const detail = await metadata<SourceFamily>(`${FONTSOURCE}/v1/registry/families/${family}`);
    const font = detail.sources?.find(
      (s) =>
        s.sha256 === source &&
        s.type === 'static' &&
        ['ttf', 'otf'].includes(s.format) &&
        s.size > 0 &&
        s.size <= MAX_FONT_BYTES,
    );
    if (!allowedFamily(detail) || detail.id !== family || !font)
      fail(404, 'This font is unavailable.');
    data = await upstream(
      `${FONTSOURCE}/v1/registry/sources/${source}`,
      MAX_FONT_BYTES,
      31536000,
      source,
    );
    expected = source;
  } else if (
    provider === 'fontshare' &&
    parts.length === 4 &&
    UUID.test(family) &&
    UUID.test(source) &&
    HASH.test(revision)
  ) {
    const entry = (await shareFamilies()).find((f) => f.id === family);
    const style = entry?.styles.find((s) => s.id === source && !s.is_variable);
    if (!style) fail(404, 'This font is unavailable.');
    const url = shareUrl(style);
    if ((await sha256(url)) !== revision)
      fail(404, 'This font version has changed. Try editing again.');
    data = await upstream(url, MAX_FONT_BYTES, 31536000, null);
  } else return fail(404, 'This font is unavailable.');
  const signature = new TextDecoder().decode(data.subarray(0, 4));
  if (signature !== 'OTTO' && signature !== '\u0000\u0001\u0000\u0000' && signature !== 'true')
    fail(502, 'The matching font could not be verified.');
  const hash = await sha256(data);
  if (expected && expected !== hash) fail(502, 'The matching font could not be verified.');
  return new Response(data, {
    headers: {
      'Content-Type': signature === 'OTTO' ? 'font/otf' : 'font/ttf',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Font-Sha256': hash,
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function handleFonts(request: Request) {
  const url = new URL(request.url);
  if (request.method !== 'GET') fail(405, 'Font recovery uses GET requests only.');
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    fail(403, 'Open Rovty PDF to recover a font.');
  if (url.pathname === '/api/fonts/resolve') {
    const name = url.searchParams.get('name') || '';
    if (
      [...url.searchParams.keys()].some((key) => key !== 'name') ||
      name.length > 160 ||
      !/^[\p{L}\p{N} ._+,-]+$/u.test(name) ||
      !fontKey(name)
    )
      fail(400, 'Choose a valid font name.');
    return json(await resolveFontCandidates(name));
  }
  if (url.pathname.startsWith('/api/fonts/file/') && !url.search)
    return fontFile(url.pathname.slice('/api/fonts/file/'.length).split('/'));
  return fail(404, 'Not found.');
}
