import { native } from './native';
import { inversePoint } from './utils';
import type { Mark, NativeTextEdit, SourceFile, NativeTextResult, FontFallback } from './types';
import type { RecoveredFont } from './fontRecovery';
import { visibleTextSize } from './textMetrics';
import { localFonts } from './localFonts';
import { preferredFont } from './fontChoice';

export const usesOriginalFont = (mark: Mark) =>
  Boolean(mark.sourcePath && mark.originalText && mark.fontMode !== 'noto');

export function unchangedOriginalText(mark: Mark) {
  const original = mark.originalText,
    origin = mark.sourceOrigin;
  return (
    usesOriginalFont(mark) &&
    !!original &&
    !!origin &&
    mark.text === original.text &&
    mark.fontSize === visibleTextSize(original) &&
    mark.x === origin[0] &&
    mark.y === origin[1] &&
    mark.color === original.color &&
    mark.opacity === original.opacity
  );
}

// A rendered edit keeps the same fallback on export/redo. Different edits and
// newly supplied local fonts get a fresh exact-font attempt. Nothing persists.
const decisions = new WeakMap<Mark, { name: string; fonts: RecoveredFont[] }>();
export async function applyTextEdits(
  source: SourceFile,
  marks: Mark[],
  onFallbacks?: (items: FontFallback[]) => void,
) {
  const fonts = localFonts(source);
  const edits: NativeTextEdit[] = marks
    .filter((mark) => mark.sourcePath && !unchangedOriginalText(mark))
    .map((mark) => {
      const prior = decisions.get(mark);
      const fallbackFont =
        (mark.fontFallback !== 'off' ? mark.fontFallback : undefined) ||
        (prior &&
        prior.fonts.length === fonts.length &&
        prior.fonts.every((font, i) => font === fonts[i])
          ? prior.name
          : undefined);
      const origin = mark.sourceOrigin || [mark.x, mark.y];
      const transform = source.pages[mark.page].transform;
      const before = inversePoint(transform, origin[0], origin[1]);
      const after = inversePoint(transform, mark.x, mark.y);
      return {
        id: mark.id,
        page: mark.page,
        path: mark.sourcePath!,
        text: mark.text || '',
        remove: !usesOriginalFont(mark),
        delta: [after[0] - before[0], after[1] - before[1]],
        scale:
          mark.fontSize / (mark.originalText ? visibleTextSize(mark.originalText) : mark.fontSize),
        allowFallback: mark.fontFallback !== 'off' && mark.text !== mark.originalText?.text,
        fallbackFont,
        preferredFallback: preferredFont(source, mark.originalText?.fontName || ''),
        ...(mark.originalText?.runs ? { block: mark.originalText } : {}),
        ...(mark.color !== mark.originalText?.color ? { color: mark.color } : {}),
        ...(mark.opacity !== mark.originalText?.opacity ? { opacity: mark.opacity } : {}),
      };
    });
  if (!edits.length) {
    onFallbacks?.([]);
    return source.bytes;
  }
  const result = await native<NativeTextResult>('edit-text', source.bytes, {
    edits,
    localFonts: fonts,
    reportFallbacks: true,
    originalFonts: Object.fromEntries(marks.map((mark) => [mark.id, mark.originalText?.fontName])),
  });
  for (const fallback of result.fallbacks) {
    const mark = marks.find((mark) => mark.id === fallback.id);
    if (mark) decisions.set(mark, { name: fallback.replacementFont, fonts });
  }
  onFallbacks?.(result.fallbacks);
  return result.bytes;
}
