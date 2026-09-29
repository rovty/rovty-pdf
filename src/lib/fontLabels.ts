import { cleanFontName, fontKey } from '../../shared/fonts';
import type { Mark } from './types';

export const hasSinhala = (text: string) => /\p{Script=Sinhala}/u.test(text);
export const isIskoolaPota = (name: string) =>
  /^iskoolapota(?:regular|bold)?$/.test(fontKey(cleanFontName(name)));
export const replacementFontLabel = (family: Mark['fontFamily']) =>
  ({ noto: 'Noto Sans', serif: 'Serif', mono: 'Monospace', sinhala: 'Noto Serif Sinhala' })[
    family || 'noto'
  ];
