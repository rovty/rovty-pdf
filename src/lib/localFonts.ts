import type { SourceFile } from './types';
import { recoveryFontName, type RecoveredFont } from './fontRecovery';

// Scoped to this open document and held only in memory. Never put private
// font programs in cookies, storage, the offline cache or online requests.
const documents = new WeakMap<SourceFile, Map<string, RecoveredFont>>();

export function localFonts(source: SourceFile) {
  return [...(documents.get(source)?.values() || [])];
}

export function hasLocalFont(source: SourceFile, name: string) {
  return documents.get(source)?.has(recoveryFontName(name)) || false;
}

export function setLocalFont(source: SourceFile, font: RecoveredFont) {
  const fonts = documents.get(source) || new Map<string, RecoveredFont>();
  const name = recoveryFontName(font.name);
  if (!fonts.has(name) && fonts.size >= 8)
    throw new Error('This PDF already has eight loaded font files. Remove an unused font first.');
  fonts.set(name, font);
  documents.set(source, fonts);
}

export function removeLocalFont(source: SourceFile, name: string) {
  documents.get(source)?.delete(recoveryFontName(name));
}
