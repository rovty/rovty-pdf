export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const json = (body: unknown, status = 200, extra: HeadersInit = {}) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      ...extra,
    },
  });
export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
export async function bytes(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') || 0) > limit)
    fail(413, 'This file exceeds the cloud upload limit.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        fail(413, 'This upload is too large.');
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
    offset += chunk.byteLength;
  }
  return data;
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const data = await bytes(request, 32768);
  try {
    const result = JSON.parse(new TextDecoder().decode(data));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    return fail(400, 'Invalid request.');
  }
}
export function text(value: unknown, max: number, fallback = '') {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)
  )
    fail(400, 'Invalid text.');
  return value.trim();
}
export const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export const sha256 = async (value: string | Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
export const equal = (a: string, b: string) => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};
export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function pdf(request: Request, limit: number) {
  const data = await bytes(request, limit);
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes('%PDF-'))
    fail(400, 'Choose a PDF file.');
  return data;
}
