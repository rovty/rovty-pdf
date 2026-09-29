import { native } from './native';
import { inversePoint } from './utils';
import type { Mark, NativeTextEdit, SourceFile } from './types';
import { visibleTextSize } from './textMetrics';
import { localFonts } from './localFonts';

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

export async function applyTextEdits(source: SourceFile, marks: Mark[]) {
  const edits: NativeTextEdit[] = marks
    .filter((mark) => mark.sourcePath && !unchangedOriginalText(mark))
    .map((mark) => {
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
        ...(mark.originalText?.runs ? { block: mark.originalText } : {}),
        ...(mark.color !== mark.originalText?.color ? { color: mark.color } : {}),
        ...(mark.opacity !== mark.originalText?.opacity ? { opacity: mark.opacity } : {}),
      };
    });
  return edits.length
    ? native('edit-text', source.bytes, { edits, localFonts: localFonts(source) })
    : source.bytes;
}
