import catalog from './recoveryFonts.json';
import {
  cleanFontName,
  fontKey,
  MAX_FONT_BYTES,
  MAX_FONT_CANDIDATES,
  type FontCandidate,
} from '../../shared/fonts';

export class FontRecoveryError extends Error {
  constructor(
    readonly fontName: string,
    readonly originalText: string,
  ) {
    super(
      `The PDF's ${fontName} font does not contain all the characters needed for this edit, or its encoding cannot write them. An exact matching font could not be recovered. Keep supported characters, or choose another Text font. Your typeface is never changed automatically.`,
    );
  }
}

export class FontMatchError extends Error {
  constructor(readonly fontName: string) {
    super(
      `A matching version of ${fontName} could not be verified against this PDF's character shapes and spacing. Choose another Text font to continue.`,
    );
  }
}

export interface RecoveredFont {
  name: string;
  // A small, locally constructed PDF transports the complete OpenType font
  // into the native engine with the correct FontFile3/OpenType encoding.
  // It contains a single public sample character, never document text.
  pdf: Uint8Array;
}

export function recoveryFontName(name: string) {
  return cleanFontName(name);
}
export function recoveryFontEntry(name: string) {
  const key = recoveryFontName(name);
  return Object.hasOwn(catalog, key) ? catalog[key as keyof typeof catalog] : undefined;
}

export async function prepareRecoveryFont(
  name: string,
  bytes: Uint8Array,
  family?: string,
  unnamedProviderFont = false,
): Promise<RecoveredFont> {
  const [{ PDFDocument, PDFName, PDFRawStream, PDFDict, PDFArray }, { default: fontkit }] =
    await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  name = recoveryFontName(name);
  const parsed = fontkit.create(bytes);
  // Some Fontshare static files use the literal placeholder "false" in all
  // name fields. The vetted catalog supplies their family identity; native
  // outline/width verification remains mandatory before any replacement.
  const unnamed =
    unnamedProviderFont && parsed.postscriptName === 'false' && parsed.familyName === 'false';
  if (
    !unnamed &&
    (family
      ? fontKey(parsed.familyName || '') !== fontKey(family) &&
        !fontKey(parsed.postscriptName || '').startsWith(fontKey(family))
      : parsed.postscriptName !== name)
  )
    throw new Error('The matching font could not be verified. Choose another Text font.');
  if (
    (parsed as typeof parsed & { variationAxes?: Record<string, unknown> }).variationAxes &&
    Object.keys(
      (parsed as typeof parsed & { variationAxes: Record<string, unknown> }).variationAxes,
    ).length
  )
    throw new Error('This font needs a static version for PDF editing.');
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(bytes, { subset: false, customName: name });
  const sample = parsed.characterSet.find((code) => code > 32 && code < 0xd800);
  if (!sample) throw new Error('The matching font has no usable characters.');
  document
    .addPage([100, 100])
    .drawText(String.fromCodePoint(sample), { font, size: 12, x: 10, y: 50 });
  await document.flush();
  // The fontkit adapter does not expose CFF detection to pdf-lib for complete
  // OpenType files. Describe the unmodified OTTO program correctly in the PDF.
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'OTTO') {
    const root = document.context.lookup(font.ref, PDFDict);
    const descendant = root.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const program =
      descriptor.get(PDFName.of('FontFile2')) ?? descriptor.get(PDFName.of('FontFile3'));
    const stream = document.context.lookup(program);
    if (!(stream instanceof PDFRawStream))
      throw new Error('The font program could not be embedded.');
    descriptor.delete(PDFName.of('FontFile2'));
    descriptor.set(PDFName.of('FontFile3'), program!);
    stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'));
    descendant.set(PDFName.of('Subtype'), PDFName.of('CIDFontType0'));
    descendant.delete(PDFName.of('CIDToGIDMap'));
  }
  return { name, pdf: await document.save() };
}

const downloads = new Map<string, Promise<RecoveredFont>>();
const lookups = new Map<
  string,
  { expires: number; value: Promise<{ candidates: FontCandidate[]; incomplete?: boolean }> }
>();
const options = () => ({
  credentials: 'omit' as const,
  referrerPolicy: 'no-referrer' as const,
  signal: AbortSignal.timeout(15000),
});
async function lookup(name: string) {
  let cached = lookups.get(name);
  if (!cached || cached.expires < Date.now()) {
    const value = (async () => {
      const response = await fetch(
        `/api/fonts/resolve?name=${encodeURIComponent(name)}`,
        options(),
      );
      if (!response.ok) throw new Error('Font lookup is unavailable.');
      const result = (await response.json()) as {
        candidates: FontCandidate[];
        incomplete?: boolean;
      };
      if (!Array.isArray(result.candidates)) throw new Error('Invalid font lookup.');
      result.candidates = result.candidates
        .slice(0, MAX_FONT_CANDIDATES)
        .filter(
          (entry) =>
            /^\/api\/fonts\/file\/(fontsource|fontshare)\/[a-z0-9/-]+$/.test(entry.path) &&
            typeof entry.family === 'string' &&
            entry.family.length <= 160 &&
            (!entry.sha256 || /^[a-f0-9]{64}$/.test(entry.sha256)),
        );
      return result;
    })().catch((error) => {
      lookups.delete(name);
      throw error;
    });
    cached = { expires: Date.now() + 10 * 60 * 1000, value };
    if (lookups.size >= 128) lookups.delete(lookups.keys().next().value!);
    lookups.set(name, cached);
  }
  return cached.value;
}

function download(name: string, entry: { path: string; sha256?: string; family?: string }) {
  const key = `${name}:${entry.path}`;
  let pending = downloads.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(entry.path, options());
      if (!response.ok) throw new Error('Font download failed.');
      if (Number(response.headers.get('content-length') || 0) > MAX_FONT_BYTES)
        throw new Error('Invalid font size.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_FONT_BYTES) throw new Error('Invalid font size.');
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const expected = entry.sha256 || response.headers.get('X-Font-Sha256');
      if (!expected || hash !== expected) throw new Error('Font verification failed.');
      return prepareRecoveryFont(
        name,
        bytes,
        entry.family,
        entry.path.startsWith('/api/fonts/file/fontshare/'),
      );
    })().catch(() => {
      downloads.delete(key);
      throw new Error(
        `Rovty could not load a matching ${name} font. Check your connection and try editing again, or choose another Text font. Your PDF has not been uploaded.`,
      );
    });
    if (downloads.size >= 64) downloads.delete(downloads.keys().next().value!);
    downloads.set(key, pending);
  }
  return pending;
}

export async function* recoveryFonts(name: string): AsyncGenerator<RecoveredFont> {
  name = recoveryFontName(name);
  let problem: unknown;
  const bundled = recoveryFontEntry(name);
  if (bundled) {
    try {
      yield await download(name, bundled);
    } catch (error) {
      problem = error;
    }
  }
  try {
    const result = await lookup(name);
    for (const entry of result.candidates) {
      try {
        yield await download(name, entry);
      } catch (error) {
        problem = error;
      }
    }
    if (result.incomplete) {
      lookups.delete(name);
      problem = new Error('Font lookup is temporarily unavailable. Try editing again.');
    }
  } catch {
    problem ||= new Error(
      'Font lookup is temporarily unavailable. Try editing again. Your PDF has not been uploaded.',
    );
  }
  if (problem) throw problem;
}
