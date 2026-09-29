import type { PDFDocument } from 'pdf-lib';

export function editorPageOrder(order: number[] | undefined, count: number): number[] {
  if (!order) return Array.from({ length: count }, (_, index) => index);
  if (
    order.length !== count ||
    new Set(order).size !== count ||
    order.some((index) => !Number.isInteger(index) || index < 0 || index >= count)
  )
    throw new Error('The page order is invalid. Keep each page exactly once.');
  return order;
}

export function movePage(order: number[], from: number, to: number): number[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) return order;
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function reorderDocumentPages(doc: PDFDocument, order?: number[]) {
  const indices = editorPageOrder(order, doc.getPageCount());
  if (indices.every((index, position) => index === position)) return;
  const pages = doc.getPages();
  // Reinsert the same page objects so widgets, links and bookmarks keep their
  // existing references. Copying pages into a new document would lose these.
  for (let index = pages.length - 1; index >= 0; index--) doc.removePage(index);
  for (const index of indices) doc.addPage(pages[index]);
}
