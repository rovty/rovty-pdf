import { cleanFontName, fontKey } from '../../shared/fonts';
import type { Mark, FontFallback } from './types';

export const hasSinhala = (text: string) => /\p{Script=Sinhala}/u.test(text);
export const isIskoolaPota = (name: string) =>
  /^iskoolapota(?:regular|bold)?$/.test(fontKey(cleanFontName(name)));
export const replacementFontLabel = (family: Mark['fontFamily']) =>
  ({ noto: 'Noto Sans', serif: 'Serif', mono: 'Monospace', sinhala: 'Noto Serif Sinhala' })[
    family || 'noto'
  ];
export const fallbackFontLabel = (name: string) =>
  name.replace(/^Noto(Serif|Sans)-/, 'Noto $1 ').replace('BoldItalic', 'Bold Italic');
export function fallbackNotice(items: FontFallback[]) {
  const changes = [
    ...new Set(
      items.map(
        (item) =>
          `${item.originalFont} → ${fallbackFontLabel(item.replacementFont)} (page ${item.page + 1})`,
      ),
    ),
  ];
  return changes.length
    ? `Font fallback: ${changes.join('; ')}. Applied only to edited lines that could not use the original font. Text appearance may differ.`
    : '';
}
