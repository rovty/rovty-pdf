import type { SourceFile } from './types';
import { cleanFontName } from '../../shared/fonts';

export type FontChoice = { originalFont: string; replacementFont: string };
export class FontChoiceError extends Error {
  readonly code = 'FONT_CHOICE';
  constructor(
    readonly editId: string,
    readonly fontChoice: FontChoice,
  ) {
    super(
      `The original ${fontChoice.originalFont} font cannot write this edit. Choose a replacement font, or keep the original text.`,
    );
  }
}

// A choice applies only to this font in this open PDF, and only after original
// and exact-font recovery fail. Never persist document font preferences.
const choices = new WeakMap<SourceFile, Map<string, string>>();
export const preferredFont = (source: SourceFile, name: string) =>
  choices.get(source)?.get(cleanFontName(name));
export function rememberFont(source: SourceFile, original: string, replacement: string) {
  const fonts = choices.get(source) || new Map<string, string>();
  fonts.set(cleanFontName(original), replacement);
  choices.set(source, fonts);
}
