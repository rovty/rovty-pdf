import { hasSinhala } from '../lib/fontLabels';
import { prepareRecoveryFont, type RecoveredFont } from '../lib/fontRecovery';

const fonts = new Map<string, Promise<RecoveredFont>>();

export function fallbackFontName(original: string, text: string) {
  // Sinhala needs shaping, not merely a different Unicode font. Keep its
  // existing explicit shaped-replacement path instead of exporting broken text.
  if (hasSinhala(text)) return;
  const serif =
    /serif|georgia|times|roman|garamond|cambria|baskerville|palatino|bookman/i.test(original) &&
    !/sans/i.test(original);
  const bold = /bold|black|heavy|demi/i.test(original),
    italic = /italic|oblique/i.test(original);
  return `Noto${serif ? 'Serif' : 'Sans'}-${bold ? (italic ? 'BoldItalic' : 'Bold') : italic ? 'Italic' : 'Regular'}`;
}

export function loadFallbackFont(name: string) {
  if (!/^Noto(?:Sans|Serif)-(?:Regular|Bold|Italic|BoldItalic)$/.test(name))
    throw new Error('Choose a supported fallback font.');
  let pending = fonts.get(name);
  if (!pending) {
    pending = (async () => {
      const serif = name.startsWith('NotoSerif-');
      const response = await fetch(`/fonts/${serif ? 'fallback/' : ''}${name}.ttf`, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('The fallback font could not load. Try editing again.');
      return prepareRecoveryFont(
        name,
        new Uint8Array(await response.arrayBuffer()),
        serif ? 'Noto Serif' : undefined,
      );
    })().catch((error) => {
      fonts.delete(name);
      throw error;
    });
    fonts.set(name, pending);
  }
  return pending;
}
