import { native } from './native';
import { inversePoint } from './utils';
import type { Mark, NativeTextEdit, SourceFile } from './types';

export const usesOriginalFont = (mark: Mark) =>
  Boolean(mark.sourcePath && mark.originalText && mark.fontMode !== 'noto');

export async function applyTextEdits(source: SourceFile, marks: Mark[]) {
  const edits: NativeTextEdit[] = marks
    .filter((mark) => mark.sourcePath)
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
        scale: mark.fontSize / (mark.originalText?.size || mark.fontSize),
        ...(mark.color !== mark.originalText?.color ? { color: mark.color } : {}),
        ...(mark.opacity !== mark.originalText?.opacity ? { opacity: mark.opacity } : {}),
      };
    });
  return edits.length ? native('edit-text', source.bytes, { edits }) : source.bytes;
}
