export interface FontCandidate {
  id: string;
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  path: string;
  sha256?: string;
  license: string;
}

export const MAX_FONT_BYTES = 12 * 1024 * 1024;
export const MAX_FONT_CANDIDATES = 6;
export const cleanFontName = (name: string) =>
  name
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/-\d{4,10}$/, '')
    .trim();
export const fontKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Names choose candidates only. The browser must still compare real glyphs.
export function matchFontFamily(name: string, family: string) {
  const key = fontKey(cleanFontName(name)),
    prefix = fontKey(family);
  if (!prefix || !key.startsWith(prefix)) return;
  let tail = key.slice(prefix.length);
  const italic = /italic|oblique/.test(tail);
  tail = tail.replace(/italic|oblique/g, '');
  const weights: Record<string, number> = {
    '': 400,
    regular: 400,
    normal: 400,
    roman: 400,
    book: 400,
    thin: 100,
    hairline: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    ultrabold: 800,
    black: 900,
    heavy: 900,
  };
  const weight = Object.hasOwn(weights, tail)
    ? weights[tail]
    : /^[1-9]00$/.test(tail)
      ? Number(tail)
      : undefined;
  if (weight === undefined) return;
  return { weight, style: italic ? ('italic' as const) : ('normal' as const) };
}
