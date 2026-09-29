import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  degrees,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  setLineJoin,
  type PDFPage,
} from 'pdf-lib';
import type { Mark, PageInfo } from './types';
import { inversePoint } from './utils';

export function drawHighlight(page: PDFPage, mark: Mark, info: PageInfo) {
  const color = rgb(
    ...([1, 3, 5].map((offset) => parseInt(mark.color.slice(offset, offset + 2), 16) / 255) as [
      number,
      number,
      number,
    ]),
  );
  if (mark.highlightMode === 'freehand' && mark.points?.length) {
    // One continuous stroke applies opacity once, avoiding dark segment joins.
    const path = mark.points
      .map(([dx, dy], index) => {
        const [x, y] = inversePoint(info.transform, mark.x + dx, mark.y + dy);
        return `${index ? 'L' : 'M'} ${x} ${-y}`;
      })
      .join(' ');
    page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
    page.drawSvgPath(path, {
      x: 0,
      y: 0,
      borderWidth: mark.strokeWidth,
      borderColor: color,
      borderOpacity: mark.opacity,
      borderLineCap: LineCapStyle.Round,
      blendMode: BlendMode.Multiply,
    });
    page.pushOperators(popGraphicsState());
    return;
  }
  for (const rect of mark.highlightRects || [
    { x: 0, y: 0, width: mark.width, height: mark.height },
  ]) {
    const [x, y] = inversePoint(info.transform, mark.x + rect.x, mark.y + rect.y + rect.height);
    page.drawRectangle({
      x,
      y,
      width: rect.width,
      height: rect.height,
      rotate: degrees(info.rotation),
      color,
      opacity: mark.opacity,
      borderWidth: 0,
      blendMode: BlendMode.Multiply,
    });
  }
}
